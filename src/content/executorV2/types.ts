import type { PageField } from '@/shared/pageModel'
import type { ProjectedValue } from '@/shared/semanticPlan'

export type ExecutionState = 'verified' | 'manual' | 'failed'
export type FailureClass = 'semantic' | 'control' | 'validation' | 'stale-ref'

export interface ControlExecutionRequest {
  field: PageField
  value: ProjectedValue
}

export interface ControlExecutionResult {
  fieldId: string
  state: ExecutionState
  mapped: boolean
  written: boolean
  committed: boolean
  verified: boolean
  failureClass?: FailureClass
  message: string
}
