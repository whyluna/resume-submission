import type { FormComponentPartIR, FormFieldIR, FormPageIR, FormPartFormat } from '@/shared/formIr'
import { actionToolsForCapabilities } from '@/shared/formIr'
import type { ControlGroupKind, ControlPartRole, PageField, PageModel } from '@/shared/pageModel'
import type { PrivacyMode, Profile } from '@/shared/types'
import { redactCaptureText, sanitizeCaptureUrl } from '../capture/sanitize'
import { resolveElement } from '../executorV2/dom'
import { buildEntryRoutes, buildSectionRouteIR } from '../planner/entryRoutes'
import { generateRuleCandidateIndex, type RuleCandidateIndex } from '../planner/ruleCandidates'
import { buildAgentObservation } from './observe'

function safeText(value: string | null | undefined, max = 100): string {
  return redactCaptureText((value ?? '').replace(/\s+/g, ' ').trim()).slice(0, max)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char)
}

function partFormat(role: ControlPartRole, el: Element | null): FormPartFormat {
  if (role === 'current-toggle') return 'boolean'
  if (role === 'start-year' || role === 'end-year' || role === 'year') return 'YYYY'
  if (role === 'start-month' || role === 'end-month' || role === 'month') return 'MM'
  if (role === 'start-day' || role === 'end-day' || role === 'day') return 'DD'
  if (el instanceof HTMLInputElement && el.type === 'month') return 'YYYY-MM'
  if (el instanceof HTMLInputElement && ['date', 'datetime-local'].includes(el.type)) return 'YYYY-MM-DD'
  return 'text'
}

function interaction(kind: ControlGroupKind, role: ControlPartRole): FormComponentPartIR['interaction'] {
  if (role === 'current-toggle' || kind === 'checkbox') return 'toggle'
  if (kind === 'native-select') return 'native-select'
  if (['custom-select', 'combobox', 'cascader'].includes(kind)) return 'open-overlay-click-option'
  if (kind === 'file' || kind === 'unknown') return 'manual'
  return 'set-text'
}

function optionSamples(field: PageField, el: Element | null): string[] {
  const values = el instanceof HTMLSelectElement
    ? Array.from(el.options).map((option) => safeText(option.textContent, 60))
    : field.control.options.map((option) => safeText(option, 60))
  return Array.from(new Set(values.filter((value) => value && !/^(请选择|请选|选择|select|--+)$/.test(value.toLowerCase())))).slice(0, 20)
}

function partIr(field: PageField, partIndex: number, doc: Document): FormComponentPartIR {
  const part = field.control.parts[partIndex]
  const el = resolveElement(part.ref, doc)
  const kind = part.controlKind ?? field.control.kind
  const options = optionSamples(field, el)
  const selectLike = ['native-select', 'custom-select', 'combobox', 'cascader', 'radio-group'].includes(kind)
  const input = el instanceof HTMLInputElement ? el : null
  return {
    partId: part.ref.signature,
    roleCandidates: [part.role],
    role: part.role,
    controlKind: kind,
    tag: el?.tagName.toLowerCase() ?? 'unknown',
    inputType: input?.type ?? '',
    domRole: safeText(el?.getAttribute('role'), 40),
    placeholder: safeText(input?.placeholder ?? el?.getAttribute('placeholder'), 80),
    ariaLabel: safeText(el?.getAttribute('aria-label'), 80),
    required: !!(input?.required || el?.getAttribute('aria-required') === 'true' || field.control.required),
    readOnly: !!(input?.readOnly || field.control.readOnly),
    disabled: !!(input?.disabled || field.control.disabled),
    format: partFormat(part.role, el),
    optionSource: options.length > 0 ? 'static' : selectLike ? 'dynamic' : 'none',
    optionSamples: options,
    interaction: interaction(kind, part.role),
  }
}

function dateShape(kind: ControlGroupKind): FormFieldIR['constraints']['dateShape'] {
  if (kind === 'date-single') return 'single'
  if (kind === 'date-range') return 'range'
  if (kind === 'date-parts') return 'parts'
  if (kind === 'date-range-parts') return 'range-parts'
  return 'none'
}

function evidence(kind: ControlGroupKind): FormFieldIR['constraints']['successEvidence'] {
  if (['native-select', 'custom-select', 'combobox', 'cascader', 'radio-group'].includes(kind)) return 'selected-state'
  if (kind === 'checkbox') return 'checked-state'
  if (kind === 'file' || kind === 'unknown') return 'manual'
  return 'value'
}

function componentHtml(field: FormFieldIR): string {
  const label = escapeHtml(field.labels[0] ?? '')
  const parts = field.parts.map((part) => {
    const attrs = [
      `id="${escapeHtml(part.partId)}"`,
      `role="${escapeHtml(part.role)}"`,
      `kind="${escapeHtml(part.controlKind)}"`,
      `format="${part.format}"`,
      `interaction="${part.interaction}"`,
      part.placeholder ? `placeholder="${escapeHtml(part.placeholder)}"` : '',
      part.ariaLabel ? `aria-label="${escapeHtml(part.ariaLabel)}"` : '',
      part.required ? 'required="true"' : '',
      part.disabled ? 'disabled="true"' : '',
      part.readOnly ? 'readonly="true"' : '',
      part.optionSource !== 'none' ? `options="${part.optionSource}"` : '',
    ].filter(Boolean).join(' ')
    return `<control ${attrs}/>`
  }).join('')
  return `<field id="${escapeHtml(field.fieldId)}" label="${label}" kind="${field.controlKind}">${parts}</field>`
}

export function buildFormPageIR(
  model: PageModel,
  profile: Profile,
  privacyMode: PrivacyMode,
  doc: Document = document,
  candidateIndex: RuleCandidateIndex = generateRuleCandidateIndex(model, profile),
): FormPageIR {
  const observation = buildAgentObservation(model, profile, privacyMode, candidateIndex)
  const routes = buildEntryRoutes(model, profile)
  const routeByEntryId = new Map(routes.map((route) => [route.pageEntryId, route]))
  const pageFieldById = new Map(model.sections.flatMap((section) => [
    ...section.fields,
    ...section.entries.flatMap((entry) => entry.fields),
  ]).map((field) => [field.id, field]))

  const fields = observation.fields.map((observed): FormFieldIR => {
    const pageField = pageFieldById.get(observed.fieldId)
    const parts = pageField ? pageField.control.parts.map((_, index) => partIr(pageField, index, doc)) : []
    const field: FormFieldIR = {
      ...observed,
      labels: observed.labels.map((label) => safeText(label, 100)).filter(Boolean),
      parts,
      componentHtml: '',
      allowedTools: actionToolsForCapabilities(observed.capabilities),
      ...(observed.entryId && routeByEntryId.has(observed.entryId) ? { entryRoute: routeByEntryId.get(observed.entryId) } : {}),
      constraints: {
        dateShape: dateShape(observed.controlKind),
        mustCommitOption: observed.capabilities.includes('select-option'),
        commitStrategy: safeText(pageField?.control.commitStrategy, 80),
        successEvidence: evidence(observed.controlKind),
      },
    }
    field.componentHtml = componentHtml(field)
    return field
  })

  const forbidden = [...model.globalActions, ...model.sections.flatMap((section) => section.actions)]
    .filter((action) => action.safety === 'forbidden' && ['save', 'next', 'submit', 'delete'].includes(action.kind))
    .map((action) => action.kind as 'save' | 'next' | 'submit' | 'delete')

  return {
    version: 1,
    pageId: observation.pageId,
    adapterId: observation.adapterId,
    adapterMaturity: observation.adapterMaturity,
    urlPattern: sanitizeCaptureUrl(observation.urlPattern),
    sections: buildSectionRouteIR(model, profile, routes),
    fields,
    facts: observation.facts,
    forbiddenActions: Array.from(new Set(forbidden)),
  }
}
