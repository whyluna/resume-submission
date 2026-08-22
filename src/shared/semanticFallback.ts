import type { AgentFactRef } from './agent'
import type { FormFieldIR, FormPageIR } from './formIr'
import type { SemanticPlanItem, TransformId } from './semanticPlan'

export type SemanticDecisionSource = 'llm-review' | 'rule-candidate' | 'local-safety'

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

export function safeSemanticDecision(field: FormFieldIR, ir: FormPageIR): { item: SemanticPlanItem; source: Exclude<SemanticDecisionSource, 'llm-review'> } {
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
  if (field.capabilities.includes('select-option') && selectedFacts.some((fact) => fact.sensitivity === 'restricted')) {
    return manual('受限事实禁止进入选择控件')
  }
  if (fixed && selectedFacts.some((fact) => fact.valueType !== 'enum')) {
    return manual('规则候选与固定下拉的事实类型不兼容')
  }
  return {
    source: 'rule-candidate',
    item: {
      fieldId: field.fieldId,
      decision: profilePaths.length === 1 && profilePaths[0] === candidate.path ? 'keep-rule' : 'fill',
      profilePaths,
      transform,
      confidence: candidate.confidence,
      reason: candidate.reason,
    },
  }
}

export function buildSemanticFallbackPlan(ir: FormPageIR): { plan: SemanticPlanItem[]; sources: Record<string, SemanticDecisionSource> } {
  const plan: SemanticPlanItem[] = []
  const sources: Record<string, SemanticDecisionSource> = {}
  for (const field of ir.fields) {
    const fallback = safeSemanticDecision(field, ir)
    plan.push(fallback.item)
    sources[field.fieldId] = fallback.source
  }
  return { plan, sources }
}
