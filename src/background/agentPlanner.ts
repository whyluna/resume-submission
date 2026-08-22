import type { AgentPlanEnvelope, AgentToolCall, AgentTrace } from '@/shared/agent'
import { AGENT_TOOL_NAMES } from '@/shared/agent'
import { validateAgentPlan } from '@/shared/agentValidation'
import type { PageModel } from '@/shared/pageModel'
import type { Profile, Settings } from '@/shared/types'
import { buildAgentObservation } from '@/content/agent/observe'
import { generateRuleCandidateIndex } from '@/content/planner/ruleCandidates'
import { chat, parseJsonLoose } from './llm'

const AGENT_SYSTEM = `你是简历填写 Agent 的规划器。你不直接输出值、选择器、脚本或 DOM 操作，只能返回白名单 ToolCall。你必须覆盖输入中的每个 eligible fieldId：选择一个填写工具，或明确 mark_manual/mark_skip。规则只是 hints。日期统一调用 fill_date_from_facts，由本地工具判断页面日期形态。敏感值由本地 factId 解析，不要要求或复述真实值。只输出 {"calls":[...]} JSON。`

export interface AgentShadowPlanResult extends AgentPlanEnvelope {
  trace: AgentTrace
  observationFieldCount: number
}

function parseCalls(output: string): unknown[] {
  const parsed = parseJsonLoose<unknown>(output)
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { calls?: unknown[] }).calls)) {
    return (parsed as { calls: unknown[] }).calls
  }
  return []
}

function generatedManual(fieldId: string, index: number): AgentToolCall {
  return {
    callId: `local_missing_${index}`,
    tool: 'mark_manual',
    reason: '模型两轮未覆盖该字段',
    args: { fieldId, reason: 'Agent 未能形成可靠工具计划' },
  }
}

export async function planAgentShadow(
  model: PageModel,
  profile: Profile,
  settings: Settings,
): Promise<AgentShadowPlanResult> {
  const candidates = generateRuleCandidateIndex(model, profile)
  const observation = buildAgentObservation(model, profile, settings.privacyMode, candidates)
  const validFactIds = new Set(observation.facts.map((fact) => fact.factId))
  const validSectionIds = new Set(observation.sections.map((section) => section.sectionId))
  const trace: AgentTrace = {
    traceId: `trace_${Date.now().toString(36)}`,
    providerCapability: 'json-tools',
    modelRounds: 0,
    events: [{ at: Date.now(), round: 0, kind: 'observe', message: `观察 ${observation.fields.length} 个字段` }],
    calls: [],
    results: [],
  }

  if (settings.privacyMode === 'off' || !settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    const calls = observation.fields.filter((field) => field.existingState !== 'locked')
      .map((field, index) => generatedManual(field.fieldId, index))
    trace.providerCapability = 'mapping-only'
    trace.calls = calls
    trace.events.push({ at: Date.now(), round: 0, kind: 'finish', message: 'Agent 未启用，字段标记为 manual' })
    return { calls, coveredFieldIds: calls.map((call) => (call.args as { fieldId: string }).fieldId), missingFieldIds: [], rejected: [], trace, observationFieldCount: observation.fields.length }
  }

  const runRound = async (fields: typeof observation.fields, round: number, previousIssues: string[]) => {
    trace.modelRounds++
    trace.events.push({ at: Date.now(), round, kind: round === 1 ? 'model' : 'repair', message: `请求覆盖 ${fields.length} 个字段` })
    const output = await chat(settings, [
      { role: 'system', content: AGENT_SYSTEM },
      { role: 'user', content: JSON.stringify({
        mode: 'agent-tool-plan',
        availableTools: AGENT_TOOL_NAMES,
        fields,
        facts: observation.facts,
        previousIssues,
        outputExample: {
          calls: [{ callId: 'c1', tool: 'fill_text_from_fact', reason: '语义匹配', args: { fieldId: 'field id', factIds: ['fact id'], transform: 'identity' } }],
        },
      }) },
    ], { maxTokens: 12_000, temperature: 0, timeoutMs: 60_000 })
    return parseCalls(output)
  }

  const firstRaw = await runRound(observation.fields, 1, [])
  const first = validateAgentPlan(firstRaw, observation.fields, validFactIds, validSectionIds)
  let calls = [...first.calls]
  let rejected = [...first.rejected]
  let missing = [...first.missingFieldIds]

  if (missing.length > 0) {
    const missingSet = new Set(missing)
    const missingFields = observation.fields.filter((field) => missingSet.has(field.fieldId))
    const secondRaw = await runRound(missingFields, 2, [
      `上一轮漏掉 fieldIds: ${missing.join(',')}`,
      ...rejected.map((item) => item.reason),
    ])
    const second = validateAgentPlan(secondRaw, missingFields, validFactIds, validSectionIds)
    calls.push(...second.calls)
    rejected.push(...second.rejected)
    missing = second.missingFieldIds
  }

  calls.push(...missing.map((fieldId, index) => generatedManual(fieldId, index)))
  const coveredFieldIds = Array.from(new Set(calls.flatMap((call) => 'fieldId' in call.args ? [call.args.fieldId] : [])))
  trace.calls = calls
  trace.events.push(...rejected.map((item) => ({
    at: Date.now(), round: trace.modelRounds, kind: 'tool-rejected' as const, message: item.reason,
  })))
  trace.events.push({ at: Date.now(), round: trace.modelRounds, kind: 'finish', message: `计划 ${calls.length} 个工具调用，拒绝 ${rejected.length}` })
  return { calls, coveredFieldIds, missingFieldIds: [], rejected, trace, observationFieldCount: observation.fields.length }
}
