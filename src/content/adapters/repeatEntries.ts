import type { PageModel, PageSection } from '@/shared/pageModel'
import type { Profile, SectionKey } from '@/shared/types'
import { resolveElement, waitFor } from '../executorV2/dom'
import { discoverPageModel } from '../discover/pageModel'

export interface RepeatPreparationResult {
  model: PageModel
  added: number
  messages: string[]
}

export interface EnsureSectionEntriesResult extends RepeatPreparationResult {
  sectionId: string
  previousCount: number
  currentCount: number
}

function enabledCount(profile: Profile, section: SectionKey): number {
  const rows = (profile as unknown as Record<string, unknown>)[section]
  return Array.isArray(rows) ? rows.filter((row) => (row as Record<string, unknown>)?.enabled !== false).length : 0
}

export function desiredEntryCount(section: PageSection, profile: Profile): number {
  if (section.semanticCandidates.includes('experiences') && section.semanticCandidates.includes('projects')) {
    return enabledCount(profile, 'experiences') + enabledCount(profile, 'projects')
  }
  return Math.max(0, ...section.semanticCandidates.map((candidate) => enabledCount(profile, candidate)))
}

/** Only invokes actions explicitly classified as automatic add. Never save/delete/next/submit. */
export async function prepareRepeatEntries(
  initial: PageModel,
  profile: Profile,
  doc: Document = document,
): Promise<RepeatPreparationResult> {
  let model = initial
  let added = 0
  const messages: string[] = []
  for (const initialSection of initial.sections) {
    const desired = desiredEntryCount(initialSection, profile)
    if (desired <= initialSection.entries.length) continue
    let section = model.sections.find((candidate) => candidate.id === initialSection.id)
      ?? model.sections.find((candidate) => candidate.title === initialSection.title)
    while (section && section.entries.length < desired) {
      const action = section.actions.find((candidate) => candidate.kind === 'add' && candidate.safety === 'automatic')
      const button = action ? resolveElement(action.ref, doc) : null
      if (!action || !(button instanceof HTMLElement)) {
        messages.push(`${section.title}：缺少安全的添加动作`)
        break
      }
      const before = section.entries.length
      button.click()
      const increased = await waitFor(() => {
        const fresh = discoverPageModel(doc, model.url)
        const current = fresh.sections.find((candidate) => candidate.title === section?.title)
        return (current?.entries.length ?? 0) > before
      }, 2000)
      model = discoverPageModel(doc, model.url)
      section = model.sections.find((candidate) => candidate.title === initialSection.title)
      if (!increased || !section || section.entries.length <= before) {
        messages.push(`${initialSection.title}：点击添加后条目数未增加`)
        break
      }
      added++
      messages.push(`${initialSection.title}：已添加第 ${section.entries.length} 条`)
    }
  }
  return { model, added, messages }
}

/** Ensure one agent-selected section reaches a bounded entry count using automatic add actions only. */
export async function ensureSectionEntries(
  initial: PageModel,
  sectionId: string,
  desiredCount: number,
  doc: Document = document,
): Promise<EnsureSectionEntriesResult> {
  let model = initial
  let section = model.sections.find((candidate) => candidate.id === sectionId)
  const previousCount = section?.entries.length ?? 0
  let added = 0
  const messages: string[] = []
  if (!section) return { model, sectionId, previousCount, currentCount: 0, added, messages: ['分区引用已失效'] }

  while (section.entries.length < desiredCount) {
    const action = section.actions.find((candidate) => candidate.kind === 'add' && candidate.safety === 'automatic')
    const button = action ? resolveElement(action.ref, doc) : null
    if (!action || !(button instanceof HTMLElement)) {
      messages.push(`${section.title}：缺少安全的添加动作`)
      break
    }
    const before = section.entries.length
    button.click()
    const increased = await waitFor(() => {
      const fresh = discoverPageModel(doc, model.url)
      const current = fresh.sections.find((candidate) => candidate.title === section?.title)
      return (current?.entries.length ?? 0) === before + 1
    }, 2000)
    model = discoverPageModel(doc, model.url)
    section = model.sections.find((candidate) => candidate.title === section?.title)
    if (!increased || !section || section.entries.length !== before + 1) {
      messages.push(`点击添加后条目数未精确增加 1（原 ${before}）`)
      break
    }
    added++
    messages.push(`${section.title}：已添加第 ${section.entries.length} 条`)
  }

  return {
    model,
    sectionId: section?.id ?? sectionId,
    previousCount,
    currentCount: section?.entries.length ?? previousCount,
    added,
    messages,
  }
}
