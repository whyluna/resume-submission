import type { AgentCapability, AgentFactRef, AgentFieldObservation, AgentPageObservation } from '@/shared/agent'
import type { ControlGroupKind, PageField, PageModel, PageSection } from '@/shared/pageModel'
import type { PrivacyMode, Profile } from '@/shared/types'
import { hashSig } from '@/shared/util'
import { buildProfileFactSummaries } from '../planner/profileFacts'
import type { RuleCandidateIndex } from '../planner/ruleCandidates'

function capabilities(kind: ControlGroupKind): AgentCapability[] {
  if (['text', 'textarea', 'richtext'].includes(kind)) return ['write-text']
  if (['native-select', 'custom-select', 'combobox', 'cascader'].includes(kind)) return ['select-option']
  if (kind === 'radio-group') return ['select-option']
  if (kind === 'checkbox') return ['toggle']
  if (['date-single', 'date-parts', 'date-range', 'date-range-parts'].includes(kind)) return ['fill-date']
  if (kind === 'file') return ['upload-manual']
  return []
}

function sensitivity(path: string, masked: boolean): AgentFactRef['sensitivity'] {
  if (/idNumber|familyMembers\[|emergencyContact|photo|attachment/i.test(path)) return 'restricted'
  if (/basic\.(?:name|phone|email|address)|currentCity|nativePlace|hukou/i.test(path)) return 'personal'
  return masked ? 'sensitive' : 'normal'
}

function fieldObservation(
  section: PageSection,
  field: PageField,
  factIdByPath: Map<string, string>,
  candidates: RuleCandidateIndex,
  entryId?: string,
  entryIndex?: number,
): AgentFieldObservation {
  return {
    fieldId: field.id,
    sectionId: section.id,
    sectionTitle: section.title,
    entryId,
    entryIndex,
    labels: Array.from(new Set([
      field.signals.label,
      ...field.signals.labelNear,
      field.signals.placeholder,
      field.signals.ariaLabel,
      field.signals.title,
    ].filter(Boolean))),
    controlGroupId: field.control.id,
    controlKind: field.control.kind,
    capabilities: capabilities(field.control.kind),
    parts: field.control.parts.map((part) => ({
      partId: part.ref.signature,
      roleCandidates: [part.role],
      controlKind: part.controlKind ?? field.control.kind,
      placeholder: '',
      optionSamples: field.control.options.slice(0, 20),
    })),
    existingState: field.control.currentState,
    required: field.control.required,
    ...(field.compoundGroupId !== undefined ? {
      compound: {
        groupId: field.compoundGroupId,
        index: field.compoundIndex ?? 0,
        size: field.compoundSize ?? 1,
        siblingFieldIds: [],
      },
    } : {}),
    ruleHints: (candidates[field.id] ?? []).flatMap((candidate) => {
      const factId = factIdByPath.get(candidate.profilePath)
      return factId ? [{
        factId,
        path: candidate.profilePath,
        confidence: candidate.score,
        transform: candidate.transform,
        reason: candidate.reason,
      }] : []
    }),
  }
}

export function buildAgentObservation(
  model: PageModel,
  profile: Profile,
  privacyMode: PrivacyMode,
  candidates: RuleCandidateIndex,
): AgentPageObservation {
  const facts: AgentFactRef[] = buildProfileFactSummaries(profile, privacyMode).map((fact) => {
    const level = sensitivity(fact.path, fact.masked)
    return {
      factId: `fact_${hashSig(fact.path)}`,
      path: fact.path,
      label: fact.label,
      valueType: fact.valueType === 'date' && fact.path.endsWith('.__range') ? 'date-range' : fact.valueType,
      sensitivity: level,
      hasValue: true,
      value: level === 'restricted' ? undefined : fact.value,
    }
  })
  const factIdByPath = new Map(facts.map((fact) => [fact.path, fact.factId]))
  const fields = model.sections.flatMap((section) => [
    ...section.fields.map((field) => fieldObservation(section, field, factIdByPath, candidates)),
    ...section.entries.flatMap((entry) => entry.fields.map((field) =>
      fieldObservation(section, field, factIdByPath, candidates, entry.id, entry.index))),
  ])
  const compoundGroups = new Map<string, string[]>()
  for (const field of fields) {
    if (!field.compound) continue
    const ids = compoundGroups.get(field.compound.groupId) ?? []
    ids.push(field.fieldId)
    compoundGroups.set(field.compound.groupId, ids)
  }
  for (const field of fields) {
    if (field.compound) field.compound.siblingFieldIds = (compoundGroups.get(field.compound.groupId) ?? []).filter((id) => id !== field.fieldId)
  }
  return {
    pageId: `page_${hashSig(`${model.adapterId}|${model.url}|${model.title}`)}`,
    adapterId: model.adapterId,
    adapterMaturity: model.adapterMaturity,
    urlPattern: (() => {
      try { return new URL(model.url).origin + new URL(model.url).pathname } catch { return '' }
    })(),
    sections: model.sections.map((section) => ({
      sectionId: section.id,
      title: section.title,
      entryIds: section.entries.map((entry) => entry.id),
      fieldIds: [
        ...section.fields.map((field) => field.id),
        ...section.entries.flatMap((entry) => entry.fields.map((field) => field.id)),
      ],
    })),
    fields,
    facts,
  }
}
