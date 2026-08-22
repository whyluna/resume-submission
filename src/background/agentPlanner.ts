import type { AgentPlanEnvelope, AgentToolCall, AgentTrace } from '@/shared/agent'
import { AGENT_TOOL_NAMES } from '@/shared/agent'
import { validateAgentPlan } from '@/shared/agentValidation'
import type { PageModel } from '@/shared/pageModel'
import type { Profile, Settings } from '@/shared/types'
import { buildAgentObservation } from '@/content/agent/observe'
import { generateRuleCandidateIndex } from '@/content/planner/ruleCandidates'
import { chat, parseJsonLoose } from './llm'

const AGENT_SYSTEM = `你是简历填写 Agent 的规划器。你不直接输出值、选择器、脚本或 DOM 操作，只能返回白名单 ToolCall。你必须覆盖输入中的每个 eligible fieldId：选择一个填写工具，或明确 mark_manual/mark_skip。规则只是 hints。日期统一调用 fill_date_from_facts，由本地工具判断页面日期形态。敏感值由本地 factId 解析，不要要求或复述真实值。只输出一个合法 JSON 对象；顶层只能有 calls 键，calls 的值必须是 ToolCall 数组。不要输出 markdown、说明文字、省略号或注释。`
const AGENT_ROUND_SYSTEM = `你是简历填写 Agent 的工具决策器。你不直接输出值、选择器、脚本或 DOM 操作，只能返回白名单 ToolCall。规则只是 hints。对本轮每个字段，应选择填写工具、观察工具、mark_manual 或 mark_skip；观察工具的结果会在下一轮返回，不能在尚未看到结果时假装已选择。日期统一调用 fill_date_from_facts，由本地工具依据页面控件部件拆分。敏感值由本地 factId 解析，不要要求或复述真实值。保存、下一步、提交永远禁止。只输出一个合法 JSON 对象；顶层只能有 calls 键，calls 的值必须是 ToolCall 数组。不要输出 markdown、说明文字、省略号或注释。`

export interface AgentShadowPlanResult extends AgentPlanEnvelope {
  trace: AgentTrace
  observationFieldCount: number
}

export interface AgentRoundRequest {
  round: number
  targetFieldIds?: string[]
  previousResults?: Array<{
    fieldId?: string
    sectionId?: string
    tool: string
    status: string
    stage: string
    evidence: string[]
    errorClass?: string
    retryable: boolean
    observation?: Record<string, unknown>
  }>
  previousIssues?: string[]
}

export interface AgentRoundPlanResult extends AgentPlanEnvelope {
  trace: AgentTrace
  observationFieldCount: number
}

function parseCalls(output: string): unknown[] {
  try {
    const parsed = parseJsonLoose<unknown>(output)
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { calls?: unknown[] }).calls)) {
      return (parsed as { calls: unknown[] }).calls
    }
    return []
  } catch {
    return []
  }
}

function generatedManual(fieldId: string, index: number): AgentToolCall {
  return {
    callId: `local_missing_${index}`,
    tool: 'mark_manual',
    reason: '模型两轮未覆盖该字段',
    args: { fieldId, reason: 'Agent 未能形成可靠工具计划' },
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size))
  return output
}

function sectionAwareBatches<T extends { sectionId: string }>(items: T[], maxFields = 12): T[][] {
  const bySection = new Map<string, T[]>()
  for (const item of items) {
    const group = bySection.get(item.sectionId) ?? []
    group.push(item)
    bySection.set(item.sectionId, group)
  }
  const segments = Array.from(bySection.values()).flatMap((group) => chunks(group, maxFields))
  const batches: T[][] = []
  for (const segment of segments) {
    const current = batches.at(-1)
    if (current && current.length + segment.length <= maxFields) current.push(...segment)
    else batches.push([...segment])
  }
  return batches
}

async function mapLimited<T, R>(items: T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      output[index] = await run(items[index], index)
    }
  })
  await Promise.all(workers)
  return output
}

/** One actual agent round. Unlike shadow planning, inspection-only fields remain unresolved for the caller's next round. */
export async function planAgentRound(
  model: PageModel,
  profile: Profile,
  settings: Settings,
  request: AgentRoundRequest,
): Promise<AgentRoundPlanResult> {
  const candidates = generateRuleCandidateIndex(model, profile)
  const observation = buildAgentObservation(model, profile, settings.privacyMode, candidates)
  const targetSet = request.targetFieldIds ? new Set(request.targetFieldIds) : null
  const targetFields = observation.fields.filter((field) => field.existingState !== 'locked' && (!targetSet || targetSet.has(field.fieldId)))
  const validFactIds = new Set(observation.facts.map((fact) => fact.factId))
  const validSectionIds = new Set(observation.sections.map((section) => section.sectionId))
  const trace: AgentTrace = {
    traceId: `trace_${Date.now().toString(36)}_${request.round}`,
    providerCapability: 'json-tools',
    modelRounds: 0,
    events: [{ at: Date.now(), round: request.round, kind: 'observe', message: `本轮目标 ${targetFields.length} 个字段` }],
    calls: [], results: [],
  }

  if (targetFields.length === 0) {
    trace.events.push({ at: Date.now(), round: request.round, kind: 'finish', message: '没有待处理字段' })
    return { calls: [], coveredFieldIds: [], missingFieldIds: [], rejected: [], trace, observationFieldCount: observation.fields.length }
  }
  if (settings.privacyMode === 'off' || !settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    trace.providerCapability = 'mapping-only'
    const calls = targetFields.map((field, index) => generatedManual(field.fieldId, index))
    trace.calls = calls
    return { calls, coveredFieldIds: targetFields.map((field) => field.fieldId), missingFieldIds: [], rejected: [], trace, observationFieldCount: observation.fields.length }
  }

  const batches = sectionAwareBatches(targetFields, 12)
  const plannedBatches = await mapLimited(batches, 3, async (fields, batchIndex) => {
    trace.modelRounds++
    trace.events.push({ at: Date.now(), round: request.round, kind: request.round === 1 ? 'model' : 'repair', message: `批次 ${batchIndex + 1} 请求 ${fields.length} 个字段` })
    const sectionIds = new Set(fields.map((field) => field.sectionId))
    const profilePrefixes = new Set(model.sections.filter((section) => sectionIds.has(section.id)).flatMap((section) => section.semanticCandidates))
    const hintedFactIds = new Set(fields.flatMap((field) => field.ruleHints.map((hint) => hint.factId)))
    const relevantFacts = observation.facts.filter((fact) => hintedFactIds.has(fact.factId)
      || Array.from(profilePrefixes).some((prefix) => fact.path === prefix || fact.path.startsWith(`${prefix}.`) || fact.path.startsWith(`${prefix}[`)))
    const facts = relevantFacts.length > 0 ? relevantFacts : observation.facts
    try {
      const output = await chat(settings, [
        { role: 'system', content: AGENT_ROUND_SYSTEM },
        { role: 'user', content: JSON.stringify({
          mode: request.round === 1 ? 'agent-tool-round' : 'agent-repair-round',
          round: request.round,
          batchId: `${request.round}_${batchIndex}`,
          availableTools: AGENT_TOOL_NAMES,
          fields,
          sections: observation.sections.filter((section) => sectionIds.has(section.sectionId)),
          facts,
          previousResults: (request.previousResults ?? []).filter((result) => !result.fieldId || fields.some((field) => field.fieldId === result.fieldId)),
          previousIssues: request.previousIssues ?? [],
          instructions: [
            '为能可靠处理的字段调用填写工具；已有值字段 mark_skip；文件或无事实字段 mark_manual。',
            '控件形态不够明确时先调用 inspect_control/inspect_options/inspect_entries，下一轮会返回观察结果。',
            '日期只调用 fill_date_from_facts，分别引用开始、结束、至今事实，不拼接页面字符串。',
            '下拉只调用 select_option_from_fact，搜索输入文字不代表选中。',
            '可调用 ensure_entries，但不得调用或建议保存、下一步、提交。',
          ],
          outputExample: { calls: [{ callId: 'c1', tool: 'fill_text_from_fact', reason: '语义匹配', args: { fieldId: 'field id', factIds: ['fact id'], transform: 'identity' } }] },
        }) },
      ], { maxTokens: 6_000, temperature: 0, timeoutMs: 150_000, jsonMode: true })
      return {
        raw: parseCalls(output).map((raw) => {
          if (!raw || typeof raw !== 'object') return raw
          const value = raw as Record<string, unknown>
          return { ...value, callId: `${request.round}_${batchIndex}_${String(value.callId ?? 'call')}` }
        }),
      }
    } catch (error) {
      const issue = `批次 ${batchIndex + 1} 失败：${(error as Error).message}`
      trace.events.push({ at: Date.now(), round: request.round, kind: 'tool-rejected', message: issue })
      return { raw: [] as unknown[], issue }
    }
  })

  const rawCalls = plannedBatches.flatMap((batch) => batch.raw)
  const validated = validateAgentPlan(rawCalls, targetFields, validFactIds, validSectionIds)
  validated.rejected.push(...plannedBatches.flatMap((batch) => batch.issue ? [{ raw: null, reason: batch.issue }] : []))
  trace.calls = validated.calls
  trace.events.push(...validated.rejected.map((item) => ({
    at: Date.now(), round: request.round, kind: 'tool-rejected' as const, message: item.reason,
  })))
  trace.events.push({ at: Date.now(), round: request.round, kind: 'finish', message: `接受 ${validated.calls.length} 个调用，仍待处理 ${validated.missingFieldIds.length} 个字段` })
  return { ...validated, trace, observationFieldCount: observation.fields.length }
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
