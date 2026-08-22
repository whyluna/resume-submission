import type { FormPageIR } from '@/shared/formIr'
import { validateOneShotSemanticPlan } from '@/shared/oneShotSemanticValidation'
import { safeSemanticDecision, type SemanticDecisionSource } from '@/shared/semanticFallback'
import type { PageModel } from '@/shared/pageModel'
import type { SemanticPlanItem } from '@/shared/semanticPlan'
import type { OneShotSemanticResponse, PrivacyMode, Profile } from '@/shared/types'
import { prepareRepeatEntries, type RepeatPreparationResult } from '../adapters/repeatEntries'
import { executeSemanticPlan, type ExecutionReportV2 } from '../executorV2/executePlan'
import { buildFormPageIR } from './componentIr'

export type OneShotSemanticRequester = (ir: FormPageIR) => Promise<OneShotSemanticResponse>

export interface SemanticOnceReport {
  prepared: RepeatPreparationResult
  ir: FormPageIR
  review: OneShotSemanticResponse
  plan: SemanticPlanItem[]
  sources: Record<string, SemanticDecisionSource>
  execution: ExecutionReportV2
}

function locallyGuardReview(ir: FormPageIR, review: OneShotSemanticResponse): {
  plan: SemanticPlanItem[]
  sources: Record<string, SemanticDecisionSource>
  rejected: string[]
} {
  const validated = validateOneShotSemanticPlan(review.plan, ir)
  const accepted = new Map(validated.accepted.map((item) => [item.fieldId, item]))
  const plan: SemanticPlanItem[] = []
  const sources: Record<string, SemanticDecisionSource> = {}
  for (const field of ir.fields) {
    const item = accepted.get(field.fieldId)
    if (item) {
      plan.push(item)
      sources[field.fieldId] = review.sources[field.fieldId] ?? 'local-safety'
    } else {
      const fallback = safeSemanticDecision(field, ir)
      plan.push(fallback.item)
      sources[field.fieldId] = fallback.source
    }
  }
  return { plan, sources, rejected: validated.rejected }
}

/** Local structure/preparation → one semantic review request → one local execution pass → final readback. */
export async function runSemanticOnce(
  initialModel: PageModel,
  profile: Profile,
  privacyMode: PrivacyMode,
  requestReview: OneShotSemanticRequester,
  doc: Document = document,
  onProgress?: (message: string) => void,
): Promise<SemanticOnceReport> {
  onProgress?.('本地组件建模：补齐重复条目并建立档案路由…')
  const prepared = await prepareRepeatEntries(initialModel, profile, doc)
  const ir = buildFormPageIR(prepared.model, profile, privacyMode, doc)
  onProgress?.(`单次 LLM 全页面语义复审：${ir.sections.length} 个分区、${ir.fields.length} 个字段…`)
  const review = await requestReview(ir)
  if (!review.ok) throw new Error(review.error || '单次语义复审后台未响应')
  const guarded = locallyGuardReview(ir, review)
  if (guarded.rejected.length > 0) review.messages.push(`内容侧再次拒绝 ${guarded.rejected.length} 个不安全语义决策`)
  onProgress?.(`本地执行器：批量执行 ${guarded.plan.length} 个语义决策并最终读回…`)
  const execution = await executeSemanticPlan(prepared.model, profile, guarded.plan, doc)
  return { prepared, ir, review, plan: guarded.plan, sources: guarded.sources, execution }
}
