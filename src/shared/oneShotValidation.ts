import type { AgentFactRef, AgentToolCall } from './agent'
import { validateAgentPlan } from './agentValidation'
import { ACTION_AGENT_TOOLS, type FormFieldIR, type FormPageIR } from './formIr'

const ACTION_TOOLS = new Set<string>(ACTION_AGENT_TOOLS)
const SELECT_KINDS = new Set(['native-select', 'custom-select', 'radio-group'])

export interface OneShotValidationResult {
  complete: boolean
  calls: AgentToolCall[]
  rejected: string[]
  missingFieldIds: string[]
}

function fieldId(call: AgentToolCall): string | undefined {
  return 'fieldId' in call.args ? call.args.fieldId : undefined
}

function factsOf(call: AgentToolCall, facts: Map<string, AgentFactRef>): AgentFactRef[] {
  const args = call.args as unknown as Record<string, unknown>
  const ids = [args.factId, args.startFactId, args.endFactId, args.currentFactId,
    ...(Array.isArray(args.factIds) ? args.factIds : [])]
    .filter((value): value is string => typeof value === 'string')
  return ids.flatMap((id) => facts.has(id) ? [facts.get(id) as AgentFactRef] : [])
}

function leaf(path: string): string {
  return path.split('.').at(-1) ?? path
}

function semanticError(call: AgentToolCall, field: FormFieldIR, callFacts: AgentFactRef[]): string | undefined {
  if (!field.allowedTools.includes(call.tool)) return `字段 ${field.fieldId} 不允许工具 ${call.tool}`
  if (call.tool === 'mark_manual' || call.tool === 'mark_skip') return undefined
  if (field.entryRoute && callFacts.some((fact) => !fact.path.startsWith(`${field.entryRoute?.factPrefix}.`))) {
    return `字段 ${field.fieldId} 引用了其他重复条目的事实`
  }
  const structuralHints = field.compound ? field.ruleHints.filter((hint) => hint.confidence >= 0.95) : []
  if (structuralHints.length > 0 && callFacts.some((fact) => !structuralHints.some((hint) => leaf(hint.path) === leaf(fact.path)))) {
    return `字段 ${field.fieldId} 与高置信结构语义冲突`
  }
  if (call.tool === 'fill_text_from_fact' && callFacts.some((fact) => fact.valueType === 'date-range' || fact.valueType === 'boolean')) {
    return `字段 ${field.fieldId} 的文本工具引用了复合日期或布尔事实`
  }
  if (call.tool === 'select_option_from_fact') {
    const fact = callFacts[0]
    if (!fact) return `字段 ${field.fieldId} 缺少下拉事实`
    if (fact.sensitivity === 'restricted') return `字段 ${field.fieldId} 的下拉禁止使用受限事实`
    if (SELECT_KINDS.has(field.controlKind) && fact.valueType !== 'enum') {
      return `字段 ${field.fieldId} 的固定选项控件只接受枚举事实`
    }
  }
  if (call.tool === 'set_boolean_from_fact' && callFacts.some((fact) => fact.valueType !== 'boolean')) {
    return `字段 ${field.fieldId} 的开关只接受布尔事实`
  }
  if (call.tool === 'fill_date_from_facts') {
    const args = call.args
    const byId = new Map(callFacts.map((fact) => [fact.factId, fact]))
    const start = args.startFactId ? byId.get(args.startFactId) : undefined
    const end = args.endFactId ? byId.get(args.endFactId) : undefined
    const current = args.currentFactId ? byId.get(args.currentFactId) : undefined
    if ((start && start.valueType !== 'date') || (end && end.valueType !== 'date') || (current && current.valueType !== 'boolean')) {
      return `字段 ${field.fieldId} 的开始/结束/至今事实类型不正确`
    }
    const range = field.constraints.dateShape === 'range' || field.constraints.dateShape === 'range-parts'
    if (range && args.requestedShape === 'single') return `字段 ${field.fieldId} 是日期区间却请求单日期`
    if (!range && args.requestedShape === 'range') return `字段 ${field.fieldId} 是单日期却请求区间`
    if (range && (!start || (!end && !current))) return `字段 ${field.fieldId} 的日期区间事实不完整`
    if (!range && !start && !end) return `字段 ${field.fieldId} 缺少单日期事实`
  }
  return undefined
}

/** A one-shot plan is atomic: any omission, duplicate, invalid tool, or semantic mismatch rejects the whole plan. */
export function validateOneShotPlan(rawCalls: unknown[], ir: FormPageIR): OneShotValidationResult {
  const facts = new Map(ir.facts.map((fact) => [fact.factId, fact]))
  const base = validateAgentPlan(
    rawCalls,
    ir.fields,
    new Set(facts.keys()),
    new Set(ir.sections.map((section) => section.sectionId)),
  )
  const rejected = base.rejected.map((item) => item.reason)
  const byField = new Map<string, AgentToolCall[]>()
  for (const call of base.calls) {
    if (!ACTION_TOOLS.has(call.tool)) {
      rejected.push(`单次计划禁止观察或结构修改工具 ${call.tool}`)
      continue
    }
    const id = fieldId(call)
    if (!id) { rejected.push(`工具 ${call.tool} 没有 fieldId`); continue }
    const calls = byField.get(id) ?? []
    calls.push(call)
    byField.set(id, calls)
  }

  const accepted: AgentToolCall[] = []
  for (const field of ir.fields) {
    const calls = byField.get(field.fieldId) ?? []
    if (calls.length === 0) continue
    if (calls.length > 1) { rejected.push(`字段 ${field.fieldId} 有 ${calls.length} 个终态动作`); continue }
    const error = semanticError(calls[0], field, factsOf(calls[0], facts))
    if (error) rejected.push(error)
    else accepted.push(calls[0])
  }
  const covered = new Set(accepted.map((call) => fieldId(call)).filter((id): id is string => !!id))
  const missingFieldIds = ir.fields.map((field) => field.fieldId).filter((id) => !covered.has(id))
  return {
    complete: rejected.length === 0 && missingFieldIds.length === 0 && accepted.length === ir.fields.length,
    calls: accepted,
    rejected,
    missingFieldIds,
  }
}
