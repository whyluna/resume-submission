import type { ControlGroupKind } from './pageModel'

export type TransformId =
  | 'identity'
  | 'join-list'
  | 'date-range'
  | 'split-date-parts'
  | 'aggregate-text'
  | 'derive-boolean'
  | 'enum-normalize'

export const TRANSFORM_IDS: readonly TransformId[] = [
  'identity', 'join-list', 'date-range', 'split-date-parts',
  'aggregate-text', 'derive-boolean', 'enum-normalize',
]

export interface RuleCandidateV2 {
  fieldId: string
  profilePath: string
  score: number
  transform: TransformId
  reason: string
}

export interface ProfileFactSummary {
  path: string
  label: string
  valueType: 'text' | 'enum' | 'date' | 'number' | 'boolean' | 'list'
  value?: string
  masked: boolean
}

export interface PlannerFieldInput {
  fieldId: string
  sectionId: string
  sectionTitle: string
  entryId?: string
  entryIndex?: number
  label: string
  labelNear: string[]
  placeholder: string
  name: string
  id: string
  ariaLabel: string
  controlKind: ControlGroupKind
  options: string[]
  required: boolean
  currentState: 'empty' | 'non-empty' | 'locked' | 'unknown'
  ruleCandidates: RuleCandidateV2[]
}

export interface SemanticPlannerBatch {
  batchId: string
  sectionId: string
  sectionTitle: string
  fields: PlannerFieldInput[]
  profileFacts: ProfileFactSummary[]
}

export type SemanticDecision = 'fill' | 'keep-rule' | 'replace-rule' | 'manual' | 'skip'

export interface SemanticPlanItem {
  fieldId: string
  decision: SemanticDecision
  profilePaths: string[]
  transform: TransformId
  confidence: number
  reason: string
}

export interface RejectedSemanticPlanItem {
  item: unknown
  reason: string
}

export interface ValidatedSemanticPlan {
  accepted: SemanticPlanItem[]
  rejected: RejectedSemanticPlanItem[]
}

export type ProjectedValue =
  | { kind: 'scalar'; value: string }
  | { kind: 'parts'; parts: Record<string, string> }
  | { kind: 'missing'; reason: string }
