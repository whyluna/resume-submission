import type { AgentFactRef, AgentFieldObservation } from './agent'
import type { ControlGroupKind, ControlPartRole } from './pageModel'
import type { TransformId } from './semanticPlan'
import type { SectionKey } from './types'

export type FormPartFormat = 'text' | 'YYYY' | 'MM' | 'DD' | 'YYYY-MM' | 'YYYY-MM-DD' | 'boolean'

export type FormInteraction =
  | 'set-text'
  | 'native-select'
  | 'open-overlay-click-option'
  | 'toggle'
  | 'manual'

export interface EntryRouteIR {
  pageSectionId: string
  pageEntryId: string
  pageEntryIndex: number
  profileSection: SectionKey
  profileIndex: number
  factPrefix: string
}

export interface FormComponentPartIR {
  partId: string
  roleCandidates: ControlPartRole[]
  role: ControlPartRole
  controlKind: ControlGroupKind
  tag: string
  inputType: string
  domRole: string
  placeholder: string
  ariaLabel: string
  required: boolean
  readOnly: boolean
  disabled: boolean
  format: FormPartFormat
  optionSource: 'static' | 'dynamic' | 'none'
  optionSamples: string[]
  interaction: FormInteraction
}

export interface FormFieldIR extends Omit<AgentFieldObservation, 'parts'> {
  parts: FormComponentPartIR[]
  /** Locally synthesized, allow-listed HTML-like structure. Never raw outerHTML. */
  componentHtml: string
  allowedTransforms: TransformId[]
  entryRoute?: EntryRouteIR
  constraints: {
    dateShape: 'none' | 'single' | 'range' | 'parts' | 'range-parts'
    mustCommitOption: boolean
    commitStrategy: string
    successEvidence: 'value' | 'selected-state' | 'checked-state' | 'manual'
  }
}

export interface FormSectionIR {
  sectionId: string
  title: string
  semanticCandidates: SectionKey[]
  currentEntryCount: number
  desiredEntryCount: number
  entryRoutes: EntryRouteIR[]
  fieldIds: string[]
}

export interface FormPageIR {
  version: 1
  pageId: string
  adapterId: string
  adapterMaturity: string
  urlPattern: string
  sections: FormSectionIR[]
  fields: FormFieldIR[]
  facts: AgentFactRef[]
  forbiddenActions: Array<'save' | 'next' | 'submit' | 'delete'>
}
