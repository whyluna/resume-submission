import type { AdapterId, AdapterMaturity, PageSection } from '@/shared/pageModel'

export interface AdapterContext {
  document: Document
  url: string
}

export interface AdapterMatch {
  id: AdapterId
  score: number
  reasons: string[]
}

export interface PageAdapter {
  id: AdapterId
  maturity: AdapterMaturity
  match(context: AdapterContext): AdapterMatch
  refineSections?(context: AdapterContext, sections: PageSection[]): PageSection[]
}
