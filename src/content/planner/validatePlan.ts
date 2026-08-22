import type { SemanticPlanItem, SemanticPlannerBatch, ValidatedSemanticPlan } from '@/shared/semanticPlan'
import { TRANSFORM_IDS } from '@/shared/semanticPlan'

function isDecision(value: unknown): value is SemanticPlanItem['decision'] {
  return ['fill', 'keep-rule', 'replace-rule', 'manual', 'skip'].includes(String(value))
}

function transformCompatible(item: SemanticPlanItem, batch: SemanticPlannerBatch): boolean {
  const field = batch.fields.find((candidate) => candidate.fieldId === item.fieldId)
  if (!field) return false
  if (item.transform === 'split-date-single') return field.controlKind === 'date-parts'
  if (item.transform === 'split-date-parts') return field.controlKind === 'date-range-parts'
  if (item.transform === 'date-range') return ['date-single', 'date-range', 'date-range-parts'].includes(field.controlKind)
  if (item.transform === 'aggregate-text') return ['text', 'textarea', 'richtext'].includes(field.controlKind)
  if (item.transform === 'derive-boolean') {
    return ['radio-group', 'checkbox', 'native-select', 'custom-select', 'combobox'].includes(field.controlKind)
  }
  return true
}

export function validateSemanticPlan(items: unknown[], batch: SemanticPlannerBatch): ValidatedSemanticPlan {
  const fieldIds = new Set(batch.fields.map((field) => field.fieldId))
  const factPaths = new Set(batch.profileFacts.map((fact) => fact.path))
  const acceptedByField = new Map<string, SemanticPlanItem>()
  const rejected: ValidatedSemanticPlan['rejected'] = []

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') { rejected.push({ item: raw, reason: '计划项不是对象' }); continue }
    const item = raw as SemanticPlanItem
    if (!fieldIds.has(item.fieldId)) { rejected.push({ item: raw, reason: '未知 fieldId' }); continue }
    const field = batch.fields.find((candidate) => candidate.fieldId === item.fieldId)
    if (!isDecision(item.decision)) { rejected.push({ item: raw, reason: '未知 decision' }); continue }
    if (field?.currentState === 'non-empty' && ['fill', 'keep-rule', 'replace-rule'].includes(item.decision)) {
      rejected.push({ item: raw, reason: '现有非空字段默认不覆盖' }); continue
    }
    if (!TRANSFORM_IDS.includes(item.transform)) { rejected.push({ item: raw, reason: '转换不在白名单' }); continue }
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
      rejected.push({ item: raw, reason: 'confidence 必须在 0~1' }); continue
    }
    const paths = Array.isArray(item.profilePaths) ? item.profilePaths : []
    if (['fill', 'keep-rule', 'replace-rule'].includes(item.decision) && paths.length === 0) {
      rejected.push({ item: raw, reason: '填写决策缺少 profilePaths' }); continue
    }
    if (paths.some((path) => !factPaths.has(path))) { rejected.push({ item: raw, reason: '包含未知或无值路径' }); continue }
    if (!transformCompatible(item, batch)) { rejected.push({ item: raw, reason: '转换与控件类型不兼容' }); continue }

    const normalized: SemanticPlanItem = {
      fieldId: item.fieldId,
      decision: item.decision,
      profilePaths: paths,
      transform: item.transform,
      confidence: item.confidence,
      reason: String(item.reason ?? '').slice(0, 120),
    }
    const previous = acceptedByField.get(item.fieldId)
    if (!previous || normalized.confidence > previous.confidence) acceptedByField.set(item.fieldId, normalized)
  }
  return { accepted: Array.from(acceptedByField.values()), rejected }
}
