import {
  AGENT_TOOL_NAMES,
  type AgentCapability,
  type AgentFieldObservation,
  type AgentPlanEnvelope,
  type AgentToolCall,
  type AgentToolName,
} from './agent'

const TOOL_NAMES = new Set<string>(AGENT_TOOL_NAMES)
const TERMINAL_OR_ACTION = new Set([
  'fill_text_from_fact', 'select_option_from_fact', 'fill_date_from_facts', 'set_boolean_from_fact',
  'mark_manual', 'mark_skip',
])

function fieldIdOf(call: AgentToolCall): string | undefined {
  return 'fieldId' in call.args ? call.args.fieldId : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasOnlyKeys(args: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => key in args) && Object.keys(args).every((key) => allowed.has(key))
}

function validArgs(tool: AgentToolName, args: Record<string, unknown>): boolean {
  if (tool === 'inspect_section' || tool === 'inspect_entries' || tool === 'verify_section') {
    return hasOnlyKeys(args, ['sectionId']) && isString(args.sectionId)
  }
  if (tool === 'inspect_control' || tool === 'verify_field') {
    return hasOnlyKeys(args, ['fieldId']) && isString(args.fieldId)
  }
  if (tool === 'inspect_options') {
    return hasOnlyKeys(args, ['fieldId'], ['query']) && isString(args.fieldId)
      && (args.query === undefined || typeof args.query === 'string')
  }
  if (tool === 'fill_text_from_fact') {
    return hasOnlyKeys(args, ['fieldId', 'factIds', 'transform']) && isString(args.fieldId)
      && Array.isArray(args.factIds) && args.factIds.length > 0 && args.factIds.every(isString)
      && ['identity', 'join-list', 'aggregate-text'].includes(String(args.transform))
  }
  if (tool === 'select_option_from_fact') {
    return hasOnlyKeys(args, ['fieldId', 'factId', 'match']) && isString(args.fieldId) && isString(args.factId)
      && ['exact', 'synonym', 'normalized'].includes(String(args.match))
  }
  if (tool === 'fill_date_from_facts') {
    return hasOnlyKeys(args, ['fieldId', 'requestedShape'], ['startFactId', 'endFactId', 'currentFactId'])
      && isString(args.fieldId) && ['auto', 'single', 'range'].includes(String(args.requestedShape))
      && [args.startFactId, args.endFactId, args.currentFactId].some(isString)
      && [args.startFactId, args.endFactId, args.currentFactId].every((value) => value === undefined || isString(value))
  }
  if (tool === 'set_boolean_from_fact') {
    return hasOnlyKeys(args, ['fieldId', 'factId']) && isString(args.fieldId) && isString(args.factId)
  }
  if (tool === 'ensure_entries') {
    return hasOnlyKeys(args, ['sectionId', 'desiredCount']) && isString(args.sectionId)
      && Number.isInteger(args.desiredCount) && Number(args.desiredCount) >= 0 && Number(args.desiredCount) <= 50
  }
  if (tool === 'mark_manual' || tool === 'mark_skip') {
    return hasOnlyKeys(args, ['fieldId', 'reason']) && isString(args.fieldId) && isString(args.reason)
  }
  return false
}

function requiredCapability(tool: AgentToolName): AgentCapability | undefined {
  if (tool === 'fill_text_from_fact') return 'write-text'
  if (tool === 'select_option_from_fact') return 'select-option'
  if (tool === 'fill_date_from_facts') return 'fill-date'
  if (tool === 'set_boolean_from_fact') return 'toggle'
  return undefined
}

function isToolCall(raw: unknown): raw is AgentToolCall {
  if (!raw || typeof raw !== 'object') return false
  const value = raw as Record<string, unknown>
  if (!isString(value.callId) || !TOOL_NAMES.has(String(value.tool)) || !isString(value.reason) || !isRecord(value.args)) return false
  return validArgs(value.tool as AgentToolName, value.args)
}

/** Validate LLM output before any content-side tool can execute. */
export function validateAgentPlan(
  rawCalls: unknown[],
  fields: AgentFieldObservation[],
  validFactIds: Set<string>,
  validSectionIds: Set<string> = new Set(fields.map((field) => field.sectionId)),
): AgentPlanEnvelope {
  const fieldById = new Map(fields.map((field) => [field.fieldId, field]))
  const accepted: AgentToolCall[] = []
  const rejected: AgentPlanEnvelope['rejected'] = []
  const terminalCoverage = new Set<string>()
  const callIds = new Set<string>()

  for (const raw of rawCalls) {
    if (!isToolCall(raw)) { rejected.push({ raw, reason: '不是有效的白名单 ToolCall' }); continue }
    if (callIds.has(raw.callId)) { rejected.push({ raw, reason: 'callId 重复' }); continue }
    callIds.add(raw.callId)
    const fieldId = fieldIdOf(raw)
    const field = fieldId ? fieldById.get(fieldId) : undefined
    if (fieldId && !field) { rejected.push({ raw, reason: '未知 fieldId' }); continue }
    if ('sectionId' in raw.args && !validSectionIds.has(raw.args.sectionId)) {
      rejected.push({ raw, reason: '未知 sectionId' }); continue
    }
    if (field?.existingState === 'locked' && raw.tool !== 'mark_manual' && raw.tool !== 'mark_skip') {
      rejected.push({ raw, reason: 'locked 字段不可执行动作' }); continue
    }
    if (field?.existingState === 'non-empty' && TERMINAL_OR_ACTION.has(raw.tool)
      && raw.tool !== 'mark_manual' && raw.tool !== 'mark_skip') {
      rejected.push({ raw, reason: '非空字段默认不覆盖' }); continue
    }
    const capability = requiredCapability(raw.tool)
    if (field && capability && !field.capabilities.includes(capability)) {
      rejected.push({ raw, reason: `字段不支持 ${capability}` }); continue
    }
    const args = raw.args as unknown as Record<string, unknown>
    const factIds = [args.factId, args.startFactId, args.endFactId, args.currentFactId,
      ...(Array.isArray(args.factIds) ? args.factIds : [])].filter((value): value is string => typeof value === 'string')
    if (factIds.some((factId) => !validFactIds.has(factId))) {
      rejected.push({ raw, reason: '包含未知 factId' }); continue
    }
    if (raw.tool === 'ensure_entries' && (!Number.isInteger(raw.args.desiredCount) || raw.args.desiredCount < 0 || raw.args.desiredCount > 50)) {
      rejected.push({ raw, reason: 'desiredCount 越界' }); continue
    }
    accepted.push(raw)
    if (fieldId && TERMINAL_OR_ACTION.has(raw.tool)) terminalCoverage.add(fieldId)
  }

  const eligible = fields.filter((field) => field.existingState !== 'locked')
  return {
    calls: accepted,
    coveredFieldIds: Array.from(terminalCoverage),
    missingFieldIds: eligible.map((field) => field.fieldId).filter((fieldId) => !terminalCoverage.has(fieldId)),
    rejected,
  }
}
