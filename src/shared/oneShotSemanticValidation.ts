import type { AgentFactRef } from './agent'
import type { FormFieldIR, FormPageIR } from './formIr'
import type { SemanticDecision, SemanticPlanItem } from './semanticPlan'

const DECISIONS = new Set<SemanticDecision>(['fill', 'keep-rule', 'replace-rule', 'manual', 'skip'])
const FILL_DECISIONS = new Set<SemanticDecision>(['fill', 'keep-rule', 'replace-rule'])
const FIXED_SELECTS = new Set(['native-select', 'custom-select', 'radio-group'])

export interface OneShotSemanticValidationResult {
  accepted: SemanticPlanItem[]
  rejected: string[]
  missingFieldIds: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function leaf(path: string): string {
  return path.split('.').at(-1) ?? path
}

function semanticError(item: SemanticPlanItem, field: FormFieldIR, facts: AgentFactRef[]): string | undefined {
  if (field.existingState === 'locked' && item.decision !== 'skip' && item.decision !== 'manual') return '锁定字段不可填写'
  if (field.existingState === 'non-empty' && FILL_DECISIONS.has(item.decision)) return '非空字段默认不可覆盖'
  if (!FILL_DECISIONS.has(item.decision)) return undefined
  if (!field.allowedTransforms.includes(item.transform)) return `转换 ${item.transform} 与组件不兼容`
  if (field.entryRoute && facts.some((fact) => !fact.path.startsWith(`${field.entryRoute?.factPrefix}.`))) return '引用了其他重复条目的事实'
  if (field.entryId && !field.entryRoute) return '页面重复条目没有档案路由'

  const structural = field.compound ? field.ruleHints.filter((hint) => hint.confidence >= 0.95) : []
  if (structural.length > 0 && facts.some((fact) => !structural.some((hint) => leaf(hint.path) === leaf(fact.path)))) {
    return '与复合组件的高置信结构语义冲突'
  }
  if (item.decision === 'keep-rule' && item.profilePaths.some((path) => !field.ruleHints.some((hint) => hint.path === path))) {
    return 'keep-rule 没有保留规则候选'
  }
  if (field.capabilities.includes('select-option') && facts.some((fact) => fact.sensitivity === 'restricted')) return '选择控件禁止使用受限事实'
  if (FIXED_SELECTS.has(field.controlKind) && facts.some((fact) => fact.valueType !== 'enum')) return '固定选项控件只接受枚举事实'
  if (field.capabilities.includes('fill-date') && facts.some((fact) => !['date', 'date-range', 'boolean'].includes(fact.valueType))) {
    return '日期组件引用了非日期事实'
  }
  if (field.controlKind === 'checkbox' && item.transform !== 'derive-boolean' && facts.some((fact) => fact.valueType !== 'boolean')) {
    return '开关组件需要布尔事实或 derive-boolean'
  }
  return undefined
}

/** Validates a model's full-page semantic review. Browser operations are intentionally absent. */
export function validateOneShotSemanticPlan(items: unknown[], ir: FormPageIR): OneShotSemanticValidationResult {
  const fieldById = new Map(ir.fields.map((field) => [field.fieldId, field]))
  const factByPath = new Map(ir.facts.map((fact) => [fact.path, fact]))
  const rawByField = new Map<string, unknown[]>()
  const rejected: string[] = []

  for (const raw of items) {
    if (!isRecord(raw) || typeof raw.fieldId !== 'string') {
      rejected.push('计划项不是带 fieldId 的对象')
      continue
    }
    if (!fieldById.has(raw.fieldId)) {
      rejected.push(`未知 fieldId ${raw.fieldId}`)
      continue
    }
    const list = rawByField.get(raw.fieldId) ?? []
    list.push(raw)
    rawByField.set(raw.fieldId, list)
  }

  const accepted: SemanticPlanItem[] = []
  for (const field of ir.fields) {
    const raws = rawByField.get(field.fieldId) ?? []
    if (raws.length === 0) continue
    if (raws.length > 1) { rejected.push(`字段 ${field.fieldId} 有重复决策`); continue }
    const raw = raws[0] as Record<string, unknown>
    if (!DECISIONS.has(raw.decision as SemanticDecision)) { rejected.push(`字段 ${field.fieldId} 的 decision 无效`); continue }
    if (typeof raw.transform !== 'string') { rejected.push(`字段 ${field.fieldId} 缺少 transform`); continue }
    const paths = Array.isArray(raw.profilePaths) && raw.profilePaths.every((path) => typeof path === 'string')
      ? raw.profilePaths as string[] : []
    const decision = raw.decision as SemanticDecision
    if (FILL_DECISIONS.has(decision) && paths.length === 0) { rejected.push(`字段 ${field.fieldId} 的填写决策缺少路径`); continue }
    if (paths.some((path) => !factByPath.has(path))) { rejected.push(`字段 ${field.fieldId} 包含未知或无值路径`); continue }
    if (!Number.isFinite(raw.confidence) || Number(raw.confidence) < 0 || Number(raw.confidence) > 1) {
      rejected.push(`字段 ${field.fieldId} 的 confidence 无效`); continue
    }
    const normalized: SemanticPlanItem = {
      fieldId: field.fieldId,
      decision,
      profilePaths: FILL_DECISIONS.has(decision) ? Array.from(new Set(paths)) : [],
      transform: raw.transform as SemanticPlanItem['transform'],
      confidence: Number(raw.confidence),
      reason: String(raw.reason ?? '').slice(0, 120),
    }
    const error = semanticError(normalized, field, normalized.profilePaths.map((path) => factByPath.get(path) as AgentFactRef))
    if (error) rejected.push(`字段 ${field.fieldId}：${error}`)
    else accepted.push(normalized)
  }

  const covered = new Set(accepted.map((item) => item.fieldId))
  return {
    accepted,
    rejected,
    missingFieldIds: ir.fields.map((field) => field.fieldId).filter((fieldId) => !covered.has(fieldId)),
  }
}
