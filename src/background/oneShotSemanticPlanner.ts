import type { AgentFactRef } from '@/shared/agent'
import type { FormFieldIR, FormPageIR } from '@/shared/formIr'
import { validateOneShotSemanticPlan } from '@/shared/oneShotSemanticValidation'
import type { SemanticPlanItem, TransformId } from '@/shared/semanticPlan'
import type { OneShotSemanticResponse, Settings } from '@/shared/types'
import { chat, parseJsonLoose } from './llm'

const SYSTEM_PROMPT = `你是通用招聘表单的全页面语义复审器。规则已经为每个字段生成 top-N 候选，但候选只是证据，不是最终答案。你必须一次性复审 FormPageIR 中的每个字段，包括已有规则候选的标准字段和规则不确定的长尾字段。

你只能输出语义计划，不得输出工具调用、DOM 选择器、点击、脚本或真实填写值。每个字段必须且只能输出一个：fieldId、profilePaths、transform、decision、confidence、reason。

判断依据优先级：entryRoute 和组件结构约束 > 字段/分区语义与相邻组件 > ruleHints。重复条目只能引用本条 entryRoute.factPrefix。日期根据 constraints.dateShape、parts.role/format 选择允许的 transform；不要把完整区间当作年/月槽位。固定下拉只映射枚举事实；combobox/cascader 可以映射对应文本或列表。证件类型和证件号码等复合行不得颠倒。

decision：keep-rule=规则候选正确；replace-rule=规则候选错误并已改正；fill=规则没有候选但可以映射；manual=需要人工；skip=已有值、锁定或不应填写。profilePaths 只能来自 facts.path；manual/skip 的 profilePaths 必须为空。transform 只能从字段 allowedTransforms 中选择（manual/skip 固定 identity）。

只输出严格 JSON 对象 {"plan":[...]}，不要 markdown、解释、注释或省略号。`

function parsePlan(raw: string): unknown[] {
  const parsed = parseJsonLoose<unknown>(raw)
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { plan?: unknown }).plan)) return (parsed as { plan: unknown[] }).plan
  return []
}

function factMap(ir: FormPageIR): Map<string, AgentFactRef> {
  return new Map(ir.facts.map((fact) => [fact.path, fact]))
}

function inferredTransform(field: FormFieldIR, candidate?: TransformId): TransformId {
  if (candidate && field.allowedTransforms.includes(candidate)) return candidate
  if (field.controlKind === 'date-range-parts') return 'split-date-parts'
  if (field.controlKind === 'date-parts') return 'split-date-single'
  if (field.controlKind === 'date-range') return 'date-range'
  if (field.controlKind === 'checkbox') return 'derive-boolean'
  if (['native-select', 'custom-select', 'combobox', 'cascader', 'radio-group'].includes(field.controlKind)) return 'enum-normalize'
  return 'identity'
}

function rangePaths(field: FormFieldIR, facts: Map<string, AgentFactRef>): string[] {
  const prefix = field.entryRoute?.factPrefix
  if (!prefix) return []
  return ['startDate', 'endDate', 'endDateIsNow']
    .map((key) => `${prefix}.${key}`)
    .filter((path) => facts.has(path))
}

function safePlan(field: FormFieldIR, ir: FormPageIR): { item: SemanticPlanItem; source: 'rule-candidate' | 'local-safety' } {
  const manual = (reason: string): { item: SemanticPlanItem; source: 'local-safety' } => ({
    source: 'local-safety',
    item: { fieldId: field.fieldId, decision: 'manual', profilePaths: [], transform: 'identity', confidence: 1, reason },
  })
  if (field.existingState === 'locked') return {
    source: 'local-safety', item: { fieldId: field.fieldId, decision: 'skip', profilePaths: [], transform: 'identity', confidence: 1, reason: '字段已锁定' },
  }
  if (field.existingState === 'non-empty') return {
    source: 'local-safety', item: { fieldId: field.fieldId, decision: 'skip', profilePaths: [], transform: 'identity', confidence: 1, reason: '字段已有值，不覆盖' },
  }
  if (field.entryId && !field.entryRoute) return manual('页面条目没有对应档案条目')

  const facts = factMap(ir)
  const candidate = field.ruleHints.find((hint) => hint.confidence >= 0.55 && facts.has(hint.path)
    && (!field.entryRoute || hint.path.startsWith(`${field.entryRoute.factPrefix}.`)))
  if (!candidate) return manual('规则没有可靠候选，模型也未给出有效决策')
  const transform = inferredTransform(field, candidate.transform)
  let profilePaths = [candidate.path]
  if (transform === 'split-date-parts' || transform === 'date-range') {
    const paths = rangePaths(field, facts)
    if (paths.length > 0) profilePaths = paths
  }
  const selectedFacts = profilePaths.map((path) => facts.get(path)).filter((fact): fact is AgentFactRef => !!fact)
  const fixed = ['native-select', 'custom-select', 'radio-group'].includes(field.controlKind)
  if (fixed && selectedFacts.some((fact) => fact.valueType !== 'enum' || fact.sensitivity === 'restricted')) {
    return manual('规则候选与固定下拉的事实类型不兼容')
  }
  return {
    source: 'rule-candidate',
    item: {
      fieldId: field.fieldId, decision: 'keep-rule', profilePaths, transform,
      confidence: candidate.confidence, reason: candidate.reason,
    },
  }
}

function finish(
  ir: FormPageIR,
  accepted: SemanticPlanItem[],
  rejected: string[],
  messages: string[],
  modelRequestCount: 0 | 1,
  started: number,
): OneShotSemanticResponse {
  const acceptedByField = new Map(accepted.map((item) => [item.fieldId, item]))
  const plan: SemanticPlanItem[] = []
  const sources: OneShotSemanticResponse['sources'] = {}
  for (const field of ir.fields) {
    const reviewed = acceptedByField.get(field.fieldId)
    if (reviewed) {
      plan.push(reviewed)
      sources[field.fieldId] = 'llm-review'
      continue
    }
    const fallback = safePlan(field, ir)
    plan.push(fallback.item)
    sources[field.fieldId] = fallback.source
  }
  const modelDecisions = Object.values(sources).filter((source) => source === 'llm-review').length
  return {
    ok: true,
    plan,
    modelRequestCount,
    modelDecisions,
    ruleDecisions: plan.length - modelDecisions,
    manualDecisions: plan.filter((item) => item.decision === 'manual').length,
    rejected,
    messages: [...messages, `完整语义计划 ${plan.length} 项：模型复审 ${modelDecisions}，本地候选/安全决策 ${plan.length - modelDecisions}`],
    latencyMs: Date.now() - started,
    sources,
  }
}

export async function reviewPageOneShot(ir: FormPageIR, settings: Settings): Promise<OneShotSemanticResponse> {
  const started = Date.now()
  if (settings.privacyMode === 'off' || !settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    return finish(ir, [], [], ['LLM 未启用；规则候选仍由本地安全校验后执行'], 0, started)
  }
  try {
    const output = await chat(settings, [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({
        task: 'review-all-fields-once',
        form: ir,
        outputSchema: { plan: [{
          fieldId: 'exact fieldId', decision: 'fill|keep-rule|replace-rule|manual|skip',
          profilePaths: ['exact facts.path'], transform: 'one field.allowedTransforms', confidence: 0.9, reason: 'short reason',
        }] },
      }) },
    ], { maxTokens: 16_000, temperature: 0, timeoutMs: 75_000, jsonMode: true })
    const validated = validateOneShotSemanticPlan(parsePlan(output), ir)
    return finish(ir, validated.accepted, validated.rejected, [
      `单次 LLM 全页面复审：有效 ${validated.accepted.length}，漏项 ${validated.missingFieldIds.length}，拒绝 ${validated.rejected.length}`,
    ], 1, started)
  } catch (error) {
    return finish(ir, [], [], [`单次 LLM 复审失败：${(error as Error).message}；保留规则候选和本地安全决策`], 1, started)
  }
}
