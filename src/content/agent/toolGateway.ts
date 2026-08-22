import type {
  AgentPageObservation,
  AgentPlanEnvelope,
  AgentToolCall,
  AgentToolResult,
} from '@/shared/agent'
import { validateAgentPlan } from '@/shared/agentValidation'
import { normalizeDateValue } from '@/shared/dateValues'
import type { PageField, PageModel, PageSection } from '@/shared/pageModel'
import type { ProjectedValue } from '@/shared/semanticPlan'
import type { PrivacyMode, Profile } from '@/shared/types'
import { ensureSectionEntries } from '../adapters/repeatEntries'
import { discoverPageModel } from '../discover/pageModel'
import { executeControl, inspectControlOptions, verifyControlValue } from '../executorV2/controls'
import type { ControlExecutionResult } from '../executorV2/types'
import { projectDateRange, projectDateSingle, projectValues } from '../planner/projection'
import { generateRuleCandidateIndex } from '../planner/ruleCandidates'
import { buildAgentObservation } from './observe'

export interface AgentGatewayBatchResult {
  plan: AgentPlanEnvelope
  results: AgentToolResult[]
  observation: AgentPageObservation
  model: PageModel
}

function allFields(model: PageModel): Map<string, PageField> {
  return new Map(model.sections.flatMap((section) => [
    ...section.fields,
    ...section.entries.flatMap((entry) => entry.fields),
  ]).map((field) => [field.id, field]))
}

function stringify(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join('、')
  if (typeof value === 'boolean') return value ? '是' : '否'
  return value == null ? '' : String(value).trim()
}

function profileValue(profile: Profile, path: string): { ok: boolean; value: string } {
  const match = path.match(/^(\w+?)(?:\[(\d+)])?\.(\w+)$/)
  if (!match) return { ok: false, value: '' }
  const [, section, indexText, key] = match
  if (section === 'selfEvaluation') {
    const value = typeof profile.selfEvaluation === 'string'
      ? profile.selfEvaluation
      : stringify((profile.selfEvaluation as unknown as Record<string, unknown>)?.selfEvaluation)
    return { ok: !!value, value }
  }
  const source = (profile as unknown as Record<string, unknown>)[section]
  const record = indexText === undefined
    ? source
    : Array.isArray(source) ? source[Number(indexText)] : undefined
  if (!record || typeof record !== 'object') return { ok: false, value: '' }
  const item = record as Record<string, unknown>
  if (key === '__range') {
    const start = stringify(item.startDate)
    const end = item.endDateIsNow === true ? '至今' : stringify(item.endDate)
    const value = [start, end].filter(Boolean).join(' ~ ')
    return { ok: !!value, value }
  }
  if (key === 'endDate' && item.endDateIsNow === true) return { ok: true, value: '至今' }
  const value = stringify(item[key])
  return { ok: value !== '', value }
}

function fromExecution(call: AgentToolCall, execution: ControlExecutionResult): AgentToolResult {
  return {
    callId: call.callId,
    tool: call.tool,
    fieldId: execution.fieldId,
    status: execution.verified ? 'verified' : execution.state === 'manual' ? 'manual' : 'failed',
    stage: execution.verified ? 'verified' : execution.committed ? 'committed' : execution.written ? 'written' : 'mapped',
    evidence: [execution.message],
    errorClass: execution.failureClass,
    retryable: execution.failureClass === 'control' || execution.failureClass === 'stale-ref' || execution.failureClass === 'validation',
  }
}

function failed(call: AgentToolCall, message: string, errorClass: AgentToolResult['errorClass'] = 'validation'): AgentToolResult {
  return {
    callId: call.callId,
    tool: call.tool,
    fieldId: 'fieldId' in call.args ? call.args.fieldId : undefined,
    sectionId: 'sectionId' in call.args ? call.args.sectionId : undefined,
    status: 'failed',
    stage: 'observed',
    evidence: [message],
    errorClass,
    retryable: errorClass === 'control' || errorClass === 'stale-ref',
  }
}

function dateRangeValue(startRaw: string, endRaw: string, current: boolean): { projected: ProjectedValue; scalar: string } | null {
  const start = normalizeDateValue(startRaw)
  const end = normalizeDateValue(endRaw)
  if (!start.valid || !start.value || (!current && (!end.valid || !end.value))) return null
  return {
    projected: projectDateRange({ startDate: start.value, endDate: current ? '' : end.value, endDateIsNow: current }),
    scalar: `${start.value} ~ ${current ? '至今' : end.value}`,
  }
}

export class AgentToolGateway {
  private model: PageModel
  private observation: AgentPageObservation
  private readonly expectedByField = new Map<string, ProjectedValue>()
  private readonly resultByField = new Map<string, AgentToolResult>()

  constructor(
    initialModel: PageModel,
    private readonly profile: Profile,
    private readonly privacyMode: PrivacyMode,
    private readonly doc: Document = document,
  ) {
    this.model = initialModel
    this.observation = this.observe()
  }

  private observe(): AgentPageObservation {
    return buildAgentObservation(this.model, this.profile, this.privacyMode, generateRuleCandidateIndex(this.model, this.profile))
  }

  private field(fieldId: string): PageField | undefined {
    return allFields(this.model).get(fieldId)
  }

  private section(sectionId: string): PageSection | undefined {
    return this.model.sections.find((section) => section.id === sectionId)
  }

  private factValue(factId: string): { ok: boolean; value: string; path?: string } {
    const fact = this.observation.facts.find((candidate) => candidate.factId === factId)
    if (!fact) return { ok: false, value: '' }
    return { ...profileValue(this.profile, fact.path), path: fact.path }
  }

  private async executeAction(call: AgentToolCall, field: PageField, projected: ProjectedValue): Promise<AgentToolResult> {
    this.expectedByField.set(field.id, projected)
    const output = fromExecution(call, await executeControl({ field, value: projected }, this.doc))
    this.resultByField.set(field.id, output)
    return output
  }

  private async execute(call: AgentToolCall): Promise<AgentToolResult> {
    if (call.tool === 'inspect_section' || call.tool === 'inspect_entries') {
      const section = this.section(call.args.sectionId)
      if (!section) return failed(call, '分区引用已失效', 'stale-ref')
      return {
        callId: call.callId, tool: call.tool, sectionId: section.id, status: 'observed', stage: 'observed', retryable: false,
        evidence: [`分区 ${section.title}：${section.entries.length} 条，${section.fields.length + section.entries.reduce((sum, entry) => sum + entry.fields.length, 0)} 个字段`],
        observation: {
          title: section.title,
          entryCount: section.entries.length,
          entries: section.entries.map((entry) => ({ entryId: entry.id, index: entry.index, fieldIds: entry.fields.map((field) => field.id) })),
          automaticActions: section.actions.filter((action) => action.safety === 'automatic').map((action) => action.kind),
        },
      }
    }

    if (call.tool === 'inspect_control') {
      const observed = this.observation.fields.find((field) => field.fieldId === call.args.fieldId)
      if (!observed) return failed(call, '字段引用已失效', 'stale-ref')
      return {
        callId: call.callId, tool: call.tool, fieldId: observed.fieldId, status: 'observed', stage: 'observed', retryable: false,
        evidence: [`控件类型 ${observed.controlKind}，部件 ${observed.parts.length}`],
        observation: {
          labels: observed.labels, controlKind: observed.controlKind, capabilities: observed.capabilities,
          existingState: observed.existingState, required: observed.required,
          parts: observed.parts.map((part) => ({ partId: part.partId, roleCandidates: part.roleCandidates })),
        },
      }
    }

    if (call.tool === 'inspect_options') {
      const field = this.field(call.args.fieldId)
      if (!field) return failed(call, '字段引用已失效', 'stale-ref')
      const inspected = await inspectControlOptions(field, call.args.query ?? '', this.doc)
      return {
        callId: call.callId, tool: call.tool, fieldId: field.id, status: 'observed', stage: 'observed', retryable: !inspected.opened,
        evidence: [inspected.message, `读取 ${inspected.options.length} 个候选项`],
        observation: { options: inspected.options, opened: inspected.opened },
      }
    }

    if (call.tool === 'ensure_entries') {
      const ensured = await ensureSectionEntries(this.model, call.args.sectionId, call.args.desiredCount, this.doc)
      this.model = ensured.model
      this.observation = this.observe()
      const reached = ensured.currentCount >= call.args.desiredCount
      return {
        callId: call.callId, tool: call.tool, sectionId: ensured.sectionId,
        status: reached ? 'verified' : 'failed', stage: reached ? 'verified' : 'observed', retryable: !reached,
        evidence: [...ensured.messages, `条目数 ${ensured.previousCount} → ${ensured.currentCount}`],
        ...(reached ? {} : { errorClass: 'control' as const }),
        observation: { previousCount: ensured.previousCount, currentCount: ensured.currentCount, added: ensured.added },
      }
    }

    if (call.tool === 'verify_section') {
      const section = this.section(call.args.sectionId)
      if (!section) return failed(call, '分区引用已失效', 'stale-ref')
      const ids = new Set([...section.fields, ...section.entries.flatMap((entry) => entry.fields)].map((field) => field.id))
      const results = Array.from(this.resultByField.entries()).filter(([fieldId]) => ids.has(fieldId)).map(([, result]) => result)
      const verified = results.length > 0 && results.every((result) => result.status === 'verified')
      return {
        callId: call.callId, tool: call.tool, sectionId: section.id, status: verified ? 'verified' : 'ambiguous',
        stage: verified ? 'verified' : 'observed', retryable: !verified,
        evidence: [`分区已复验 ${results.length} 个动作，成功 ${results.filter((result) => result.status === 'verified').length}`],
      }
    }

    if (call.tool === 'verify_field') {
      const field = this.field(call.args.fieldId)
      const expected = this.expectedByField.get(call.args.fieldId)
      if (!field || !expected) return failed(call, '没有可复验的已执行值', 'stale-ref')
      const output = fromExecution(call, verifyControlValue(field, expected, this.doc))
      this.resultByField.set(field.id, output)
      return output
    }

    if (call.tool === 'mark_manual' || call.tool === 'mark_skip') {
      return {
        callId: call.callId, tool: call.tool, fieldId: call.args.fieldId, status: 'manual', stage: 'mapped', retryable: false,
        evidence: [call.args.reason],
      }
    }

    const field = this.field(call.args.fieldId)
    if (!field) return failed(call, '字段引用已失效', 'stale-ref')

    if (call.tool === 'fill_text_from_fact') {
      const values = call.args.factIds.map((factId) => this.factValue(factId))
      if (values.some((value) => !value.ok)) return failed(call, '至少一个事实没有本地可用值', 'semantic')
      return this.executeAction(call, field, projectValues(call.args.transform, values.map((value) => value.value)))
    }

    if (call.tool === 'select_option_from_fact' || call.tool === 'set_boolean_from_fact') {
      const fact = this.factValue(call.args.factId)
      if (!fact.ok) return failed(call, '事实没有本地可用值', 'semantic')
      return this.executeAction(call, field, { kind: 'scalar', value: fact.value })
    }

    if (call.tool === 'fill_date_from_facts') {
      const start = call.args.startFactId ? this.factValue(call.args.startFactId) : { ok: false, value: '' }
      const end = call.args.endFactId ? this.factValue(call.args.endFactId) : { ok: false, value: '' }
      const currentFact = call.args.currentFactId ? this.factValue(call.args.currentFactId) : { ok: false, value: '' }
      const current = currentFact.ok && /^(是|true|1|yes)$/i.test(currentFact.value)
      const rangeControl = field.control.kind === 'date-range' || field.control.kind === 'date-range-parts'
      const wantsRange = call.args.requestedShape === 'range' || (call.args.requestedShape === 'auto' && rangeControl)
      if (wantsRange) {
        const range = dateRangeValue(start.value, end.value, current)
        if (!start.ok || !range) return failed(call, '日期区间事实不完整或无法规范化', 'semantic')
        return this.executeAction(call, field, field.control.kind === 'date-range-parts' ? range.projected : { kind: 'scalar', value: range.scalar })
      }
      const value = start.ok ? start.value : end.value
      const normalized = normalizeDateValue(value)
      if (!normalized.valid || !normalized.value) return failed(call, '单日期事实无法规范化', 'semantic')
      const projected = field.control.kind === 'date-parts' ? projectDateSingle(normalized.value) : { kind: 'scalar' as const, value: normalized.value }
      return this.executeAction(call, field, projected)
    }

    return failed(call, '工具尚未实现', 'protocol')
  }

  async executeCalls(rawCalls: unknown[]): Promise<AgentGatewayBatchResult> {
    const plan = validateAgentPlan(
      rawCalls,
      this.observation.fields,
      new Set(this.observation.facts.map((fact) => fact.factId)),
      new Set(this.observation.sections.map((section) => section.sectionId)),
    )
    const results: AgentToolResult[] = []
    for (const call of plan.calls) results.push(await this.execute(call))
    this.model = discoverPageModel(this.doc, this.model.url)
    this.observation = this.observe()
    return { plan, results, observation: this.observation, model: this.model }
  }

  getObservation(): AgentPageObservation {
    return this.observation
  }

  getModel(): PageModel {
    return this.model
  }
}
