import type { ControlGroupKind, ControlPartRole } from './pageModel'
import type { TransformId } from './semanticPlan'

export type AgentProviderCapability = 'native-tools' | 'json-tools' | 'mapping-only' | 'unsupported'

export interface AgentFactRef {
  factId: string
  path: string
  label: string
  valueType: 'text' | 'enum' | 'date' | 'date-range' | 'boolean' | 'number' | 'list'
  sensitivity: 'normal' | 'personal' | 'sensitive' | 'restricted'
  hasValue: boolean
  value?: string
}

export interface AgentControlPartObservation {
  partId: string
  roleCandidates: ControlPartRole[]
  controlKind: ControlGroupKind
  placeholder: string
  optionSamples: string[]
}

export interface AgentFieldObservation {
  fieldId: string
  sectionId: string
  sectionTitle: string
  entryId?: string
  entryIndex?: number
  labels: string[]
  controlGroupId: string
  controlKind: ControlGroupKind
  capabilities: AgentCapability[]
  parts: AgentControlPartObservation[]
  existingState: 'empty' | 'non-empty' | 'locked' | 'unknown'
  required: boolean
  compound?: { groupId: string; index: number; size: number; siblingFieldIds: string[] }
  ruleHints: Array<{ factId: string; path: string; confidence: number; transform: TransformId; reason: string }>
}

export interface AgentPageObservation {
  pageId: string
  adapterId: string
  adapterMaturity: string
  urlPattern: string
  sections: Array<{ sectionId: string; title: string; entryIds: string[]; fieldIds: string[] }>
  fields: AgentFieldObservation[]
  facts: AgentFactRef[]
}

export type AgentCapability =
  | 'write-text'
  | 'select-option'
  | 'select-many'
  | 'fill-date'
  | 'toggle'
  | 'upload-manual'

export const AGENT_TOOL_NAMES = [
  'inspect_section',
  'inspect_control',
  'inspect_options',
  'inspect_entries',
  'fill_text_from_fact',
  'select_option_from_fact',
  'fill_date_from_facts',
  'set_boolean_from_fact',
  'ensure_entries',
  'verify_field',
  'verify_section',
  'mark_manual',
  'mark_skip',
] as const

export type AgentToolName = typeof AGENT_TOOL_NAMES[number]

interface AgentToolCallBase {
  callId: string
  tool: AgentToolName
  reason: string
}

export type AgentToolCall =
  | (AgentToolCallBase & { tool: 'inspect_section'; args: { sectionId: string } })
  | (AgentToolCallBase & { tool: 'inspect_control'; args: { fieldId: string } })
  | (AgentToolCallBase & { tool: 'inspect_options'; args: { fieldId: string; query?: string } })
  | (AgentToolCallBase & { tool: 'inspect_entries'; args: { sectionId: string } })
  | (AgentToolCallBase & { tool: 'fill_text_from_fact'; args: { fieldId: string; factIds: string[]; transform: 'identity' | 'join-list' | 'aggregate-text' } })
  | (AgentToolCallBase & { tool: 'select_option_from_fact'; args: { fieldId: string; factId: string; match: 'exact' | 'synonym' | 'normalized' } })
  | (AgentToolCallBase & { tool: 'fill_date_from_facts'; args: { fieldId: string; startFactId?: string; endFactId?: string; currentFactId?: string; requestedShape: 'auto' | 'single' | 'range' } })
  | (AgentToolCallBase & { tool: 'set_boolean_from_fact'; args: { fieldId: string; factId: string } })
  | (AgentToolCallBase & { tool: 'ensure_entries'; args: { sectionId: string; desiredCount: number } })
  | (AgentToolCallBase & { tool: 'verify_field'; args: { fieldId: string } })
  | (AgentToolCallBase & { tool: 'verify_section'; args: { sectionId: string } })
  | (AgentToolCallBase & { tool: 'mark_manual'; args: { fieldId: string; reason: string } })
  | (AgentToolCallBase & { tool: 'mark_skip'; args: { fieldId: string; reason: string } })

export type AgentToolStatus = 'verified' | 'ambiguous' | 'rejected' | 'failed' | 'manual' | 'observed'

export interface AgentToolResult {
  callId: string
  tool: AgentToolName
  fieldId?: string
  sectionId?: string
  status: AgentToolStatus
  stage: 'observed' | 'mapped' | 'written' | 'committed' | 'verified'
  evidence: string[]
  errorClass?: 'semantic' | 'control' | 'validation' | 'stale-ref' | 'safety' | 'protocol'
  retryable: boolean
  observation?: Record<string, unknown>
}

export interface AgentTraceEvent {
  at: number
  round: number
  kind: 'observe' | 'model' | 'tool-proposed' | 'tool-rejected' | 'tool-result' | 'repair' | 'finish'
  fieldId?: string
  tool?: AgentToolName
  message: string
}

export interface AgentTrace {
  traceId: string
  providerCapability: AgentProviderCapability
  modelRounds: number
  events: AgentTraceEvent[]
  calls: AgentToolCall[]
  results: AgentToolResult[]
}

export interface AgentPlanEnvelope {
  calls: AgentToolCall[]
  coveredFieldIds: string[]
  missingFieldIds: string[]
  rejected: Array<{ raw: unknown; reason: string }>
}
