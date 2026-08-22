import type { PageField, PageModel } from '@/shared/pageModel'
import type { Profile } from '@/shared/types'
import type { ProjectedValue, SemanticPlanItem } from '@/shared/semanticPlan'
import { getProfileValue } from '../matcher'
import { projectDateRange, projectValues } from '../planner/projection'
import { executeControl } from './controls'
import type { ControlExecutionResult } from './types'

export interface ExecutionReportV2 {
  total: number
  verified: number
  manual: number
  failed: number
  results: ControlExecutionResult[]
}

function allFields(model: PageModel): Map<string, PageField> {
  return new Map(model.sections.flatMap((section) => [
    ...section.fields,
    ...section.entries.flatMap((entry) => entry.fields),
  ]).map((field) => [field.id, field]))
}

function rangeSource(profile: Profile, paths: string[]): ProjectedValue | null {
  const anchor = paths.find((path) => /\.(?:__range|startDate|endDate|endDateIsNow)$/.test(path))
  const match = anchor?.match(/^(\w+)\[(\d+)]\./)
  if (!match) return null
  const rows = (profile as unknown as Record<string, unknown>)[match[1]]
  const row = Array.isArray(rows) ? rows[Number(match[2])] as Record<string, unknown> | undefined : undefined
  if (!row) return null
  return projectDateRange({
    startDate: String(row.startDate ?? ''),
    endDate: String(row.endDate ?? ''),
    endDateIsNow: row.endDateIsNow === true,
  })
}

function projectPlanValue(profile: Profile, item: SemanticPlanItem): ProjectedValue {
  if (item.transform === 'split-date-parts') {
    const range = rangeSource(profile, item.profilePaths)
    if (range) return range
  }
  const values = item.profilePaths.map((path) => getProfileValue(profile, path)).filter((value) => value.ok).map((value) => value.value)
  return projectValues(item.transform, values)
}

export async function executeSemanticPlan(
  model: PageModel,
  profile: Profile,
  plan: SemanticPlanItem[],
  doc: Document = document,
): Promise<ExecutionReportV2> {
  const fields = allFields(model)
  const results: ControlExecutionResult[] = []
  for (const item of plan) {
    const field = fields.get(item.fieldId)
    if (!field) {
      results.push({ fieldId: item.fieldId, state: 'failed', mapped: true, written: false, committed: false, verified: false, failureClass: 'stale-ref', message: '计划字段已不在当前页面模型中' })
      continue
    }
    if (item.decision === 'manual' || item.decision === 'skip') {
      results.push({ fieldId: item.fieldId, state: 'manual', mapped: true, written: false, committed: false, verified: false, failureClass: 'semantic', message: item.reason || '规划器要求人工处理' })
      continue
    }
    results.push(await executeControl({ field, value: projectPlanValue(profile, item) }, doc))
  }
  return {
    total: results.length,
    verified: results.filter((item) => item.verified).length,
    manual: results.filter((item) => item.state === 'manual').length,
    failed: results.filter((item) => item.state === 'failed').length,
    results,
  }
}
