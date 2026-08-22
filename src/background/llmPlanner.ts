import type { PageModel } from '@/shared/pageModel'
import type { SemanticPlanItem, ValidatedSemanticPlan } from '@/shared/semanticPlan'
import type { Profile, Settings } from '@/shared/types'
import { buildSemanticPlannerBatches } from '@/content/planner/batches'
import { generateRuleCandidateIndex } from '@/content/planner/ruleCandidates'
import { validateSemanticPlan } from '@/content/planner/validatePlan'
import { chat, parseJsonLoose } from './llm'

const SYSTEM_PROMPT = `你是校园招聘表单的语义规划器。规则候选只是证据，不是最终答案。你需要复审批次里的每个字段：保留正确规则、纠正错误规则、为长尾字段补充映射，或在不确定时标记 manual/skip。只输出 JSON 数组。profilePaths 必须来自给定事实列表；transform 必须来自给定白名单；不得编造简历事实、DOM 选择器或代码。`

export interface PageSemanticPlanResult extends ValidatedSemanticPlan {
  messages: string[]
}

export async function planPageSemantics(
  model: PageModel,
  profile: Profile,
  settings: Settings,
): Promise<PageSemanticPlanResult> {
  const candidates = generateRuleCandidateIndex(model)
  const batches = buildSemanticPlannerBatches(model, profile, settings.privacyMode, candidates)
  const accepted: SemanticPlanItem[] = []
  const rejected: ValidatedSemanticPlan['rejected'] = []
  const messages: string[] = []

  if (settings.privacyMode === 'off' || !settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    return { accepted, rejected, messages: ['LLM 规划未启用'] }
  }

  for (const batch of batches) {
    try {
      const output = await chat(settings, [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            task: 'review-all-fields-in-section',
            allowedTransforms: ['identity', 'join-list', 'date-range', 'split-date-parts', 'aggregate-text', 'derive-boolean', 'enum-normalize'],
            batch,
            output: [{ fieldId: 'field id', decision: 'fill|keep-rule|replace-rule|manual|skip', profilePaths: ['allowed path'], transform: 'allowed transform', confidence: 0.9, reason: 'short reason' }],
          }),
        },
      ], { maxTokens: 8192, temperature: 0 })
      const raw = parseJsonLoose<unknown[]>(output)
      const validated = validateSemanticPlan(Array.isArray(raw) ? raw : [], batch)
      accepted.push(...validated.accepted)
      rejected.push(...validated.rejected)
      messages.push(`${batch.sectionTitle}：接受 ${validated.accepted.length}，拒绝 ${validated.rejected.length}`)
    } catch (error) {
      messages.push(`${batch.sectionTitle}：LLM 规划失败，${(error as Error).message}`)
    }
  }
  return { accepted, rejected, messages }
}
