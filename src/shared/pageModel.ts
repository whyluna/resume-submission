import type { SectionKey } from './types'

export type AdapterId = 'moka' | 'dayee-wt' | 'kuma' | 'beisen' | 'generic'
export type AdapterMaturity = 'research' | 'fixture-verified' | 'live-verified'

export interface ElementRefV2 {
  cssPath: string
  index: number
  framePath: number[]
  signature: string
}

export type PageActionKind = 'add' | 'delete' | 'save' | 'next' | 'submit' | 'consent' | 'other'
export type ActionSafety = 'automatic' | 'manual' | 'forbidden'

export interface PageAction {
  id: string
  kind: PageActionKind
  text: string
  ref: ElementRefV2
  safety: ActionSafety
}

export type ControlGroupKind =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'native-select'
  | 'custom-select'
  | 'combobox'
  | 'radio-group'
  | 'checkbox'
  | 'date-single'
  | 'date-range'
  | 'date-range-parts'
  | 'cascader'
  | 'file'
  | 'unknown'

export type ControlPartRole =
  | 'root'
  | 'trigger'
  | 'input'
  | 'start'
  | 'end'
  | 'start-year'
  | 'start-month'
  | 'end-year'
  | 'end-month'
  | 'option-source'
  | 'current-toggle'

export interface ControlPart {
  role: ControlPartRole
  ref: ElementRefV2
}

export interface ControlGroup {
  id: string
  kind: ControlGroupKind
  root: ElementRefV2
  parts: ControlPart[]
  options: string[]
  required: boolean
  disabled: boolean
  readOnly: boolean
  currentState: 'empty' | 'non-empty' | 'locked' | 'unknown'
  commitStrategy: string
}

export interface SemanticSignalsV2 {
  label: string
  labelNear: string[]
  placeholder: string
  name: string
  id: string
  ariaLabel: string
  title: string
  sectionTitle: string
}

export interface PageField {
  id: string
  signals: SemanticSignalsV2
  control: ControlGroup
}

export interface PageEntry {
  id: string
  index: number
  root: ElementRefV2
  kindCandidates: SectionKey[]
  fields: PageField[]
}

export interface PageSection {
  id: string
  title: string
  root: ElementRefV2
  semanticCandidates: SectionKey[]
  entries: PageEntry[]
  fields: PageField[]
  actions: PageAction[]
}

export interface PageModel {
  version: 2
  url: string
  title: string
  capturedAt: number
  adapterId: AdapterId
  adapterMaturity: AdapterMaturity
  sections: PageSection[]
  globalActions: PageAction[]
}
