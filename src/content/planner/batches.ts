import type { PageField, PageModel } from '@/shared/pageModel'
import type { PrivacyMode, Profile } from '@/shared/types'
import type { PlannerFieldInput, SemanticPlannerBatch } from '@/shared/semanticPlan'
import { hashSig } from '@/shared/util'
import type { RuleCandidateIndex } from './ruleCandidates'
import { buildProfileFactSummaries } from './profileFacts'

function plannerField(
  field: PageField,
  sectionId: string,
  sectionTitle: string,
  candidates: RuleCandidateIndex,
  entryId?: string,
  entryIndex?: number,
): PlannerFieldInput {
  return {
    fieldId: field.id,
    sectionId,
    sectionTitle,
    entryId,
    entryIndex,
    label: field.signals.label,
    labelNear: field.signals.labelNear,
    placeholder: field.signals.placeholder,
    name: field.signals.name,
    id: field.signals.id,
    ariaLabel: field.signals.ariaLabel,
    controlKind: field.control.kind,
    options: field.control.options,
    required: field.control.required,
    currentState: field.control.currentState,
    ruleCandidates: candidates[field.id] ?? [],
  }
}

export function buildSemanticPlannerBatches(
  model: PageModel,
  profile: Profile,
  privacyMode: PrivacyMode,
  candidates: RuleCandidateIndex,
  maxFieldsPerBatch = 80,
): SemanticPlannerBatch[] {
  const profileFacts = buildProfileFactSummaries(profile, privacyMode)
  const batches: SemanticPlannerBatch[] = []
  for (const section of model.sections) {
    const fields: PlannerFieldInput[] = [
      ...section.fields.map((field) => plannerField(field, section.id, section.title, candidates)),
      ...section.entries.flatMap((entry) => entry.fields.map((field) =>
        plannerField(field, section.id, section.title, candidates, entry.id, entry.index))),
    ].filter((field) => field.currentState !== 'locked')
    for (let start = 0; start < fields.length; start += maxFieldsPerBatch) {
      const chunk = fields.slice(start, start + maxFieldsPerBatch)
      batches.push({
        batchId: `batch_${hashSig(`${section.id}|${start}|${chunk.map((field) => field.fieldId).join(',')}`)}`,
        sectionId: section.id,
        sectionTitle: section.title,
        fields: chunk,
        profileFacts,
      })
    }
  }
  return batches
}

/** Merge small section batches to reduce LLM round trips while preserving field-level section metadata. */
export function coalesceSemanticPlannerBatches(
  batches: SemanticPlannerBatch[],
  maxFieldsPerRequest = 80,
): SemanticPlannerBatch[] {
  const merged: SemanticPlannerBatch[] = []
  let pending: SemanticPlannerBatch[] = []
  let pendingFields = 0
  const flush = () => {
    if (pending.length === 0) return
    const fields = pending.flatMap((batch) => batch.fields)
    const sectionIds = Array.from(new Set(pending.map((batch) => batch.sectionId)))
    const sectionTitles = Array.from(new Set(pending.map((batch) => batch.sectionTitle)))
    merged.push({
      batchId: `batch_${hashSig(`${sectionIds.join('|')}|${fields.map((field) => field.fieldId).join(',')}`)}`,
      sectionId: sectionIds.join('+'),
      sectionTitle: sectionTitles.join(' / '),
      fields,
      profileFacts: pending[0].profileFacts,
    })
    pending = []
    pendingFields = 0
  }
  for (const batch of batches) {
    if (pendingFields > 0 && pendingFields + batch.fields.length > maxFieldsPerRequest) flush()
    pending.push(batch)
    pendingFields += batch.fields.length
    if (pendingFields >= maxFieldsPerRequest) flush()
  }
  flush()
  return merged
}
