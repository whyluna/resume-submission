import type { AgentPageObservation, AgentToolCall, AgentToolResult, AgentTrace } from '@/shared/agent'
import type { PageModel } from '@/shared/pageModel'
import type { AgentRoundResponse, PrivacyMode, Profile } from '@/shared/types'
import { AgentToolGateway } from './toolGateway'

export type AgentRoundRequester = (request: {
  model: PageModel
  round: number
  targetFieldIds: string[]
  previousResults: AgentToolResult[]
  previousIssues: string[]
}) => Promise<AgentRoundResponse>

export interface AgentRunReport {
  model: PageModel
  rounds: number
  traces: AgentTrace[]
  calls: AgentToolCall[]
  results: AgentToolResult[]
  rejected: string[]
  finalByField: Map<string, AgentToolResult>
  observation: AgentPageObservation
}

function fieldId(call: AgentToolCall): string | undefined {
  return 'fieldId' in call.args ? call.args.fieldId : undefined
}

function targetFields(gateway: AgentToolGateway, resolved: Set<string>): string[] {
  return gateway.getObservation().fields
    .filter((field) => field.existingState !== 'locked' && !resolved.has(field.fieldId))
    .map((field) => field.fieldId)
}

function terminal(call: AgentToolCall, result: AgentToolResult): boolean {
  if (call.tool === 'mark_manual' || call.tool === 'mark_skip') return true
  if (['fill_text_from_fact', 'select_option_from_fact', 'fill_date_from_facts', 'set_boolean_from_fact', 'verify_field'].includes(call.tool)) {
    return result.status === 'verified' || result.status === 'manual'
  }
  return false
}

/** Bounded observe → plan → act → verify → repair loop. The planner never receives direct DOM authority. */
export async function runAgent(
  initialModel: PageModel,
  profile: Profile,
  privacyMode: PrivacyMode,
  requestRound: AgentRoundRequester,
  doc: Document = document,
  onProgress?: (message: string) => void,
): Promise<AgentRunReport> {
  const gateway = new AgentToolGateway(initialModel, profile, privacyMode, doc)
  const resolved = new Set<string>()
  const traces: AgentTrace[] = []
  const calls: AgentToolCall[] = []
  const results: AgentToolResult[] = []
  const rejected: string[] = []
  const finalByField = new Map<string, AgentToolResult>()
  let previousResults: AgentToolResult[] = []
  let previousIssues: string[] = []
  let rounds = 0

  for (let round = 1; round <= 3; round++) {
    const targets = targetFields(gateway, resolved)
    if (targets.length === 0) break
    rounds = round
    onProgress?.(`Agent 第 ${round} 轮：处理 ${targets.length} 个字段…`)
    const planned = await requestRound({
      model: gateway.getModel(), round, targetFieldIds: targets, previousResults, previousIssues,
    })
    if (!planned.ok) {
      previousIssues = [planned.error || 'Agent 规划失败']
      rejected.push(...previousIssues)
      break
    }
    if (planned.trace) traces.push(planned.trace)
    rejected.push(...planned.rejected)
    const batch = await gateway.executeCalls(planned.calls)
    calls.push(...batch.plan.calls)
    results.push(...batch.results)
    const acceptedById = new Map(batch.plan.calls.map((call) => [call.callId, call]))
    for (const result of batch.results) {
      const call = acceptedById.get(result.callId)
      if (!call) continue
      const id = fieldId(call)
      if (id) {
        finalByField.set(id, result)
        if (terminal(call, result)) resolved.add(id)
      }
    }
    const localRejections = batch.plan.rejected.map((item) => item.reason)
    rejected.push(...localRejections)
    previousResults = batch.results
    previousIssues = [
      ...planned.missingFieldIds.map((id) => `模型未覆盖字段 ${id}`),
      ...planned.rejected,
      ...localRejections,
    ]
  }

  const remaining = targetFields(gateway, resolved)
  if (remaining.length > 0) {
    const failureByField = new Map(results.filter((result) => result.fieldId && result.status !== 'verified')
      .map((result) => [result.fieldId as string, result]))
    const manualCalls: AgentToolCall[] = remaining.map((id, index) => {
      const prior = failureByField.get(id)
      const detail = prior?.evidence[0] || previousIssues[0] || '达到 Agent 修复轮次上限'
      return {
        callId: `local_manual_${index}`,
        tool: 'mark_manual',
        reason: '本地安全终止',
        args: { fieldId: id, reason: detail },
      }
    })
    const manual = await gateway.executeCalls(manualCalls)
    calls.push(...manual.plan.calls)
    results.push(...manual.results)
    manual.results.forEach((result) => {
      if (result.fieldId) {
        finalByField.set(result.fieldId, result)
        resolved.add(result.fieldId)
      }
    })
  }

  onProgress?.(`Agent 完成：${Array.from(finalByField.values()).filter((result) => result.status === 'verified').length} 个字段已验证；未保存/未提交`)
  return { model: gateway.getModel(), rounds, traces, calls, results, rejected, finalByField, observation: gateway.getObservation() }
}
