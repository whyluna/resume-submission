import type { EntryRouteIR, FormSectionIR } from '@/shared/formIr'
import type { PageModel, PageSection } from '@/shared/pageModel'
import type { Profile, SectionKey } from '@/shared/types'
import { desiredEntryCount } from '../adapters/repeatEntries'

const PROFILE_ARRAY_SECTIONS = new Set<SectionKey>([
  'educations', 'experiences', 'projects', 'papers', 'competitions', 'awards', 'studentWork',
  'languages', 'itSkills', 'certificates', 'familyMembers',
])

function enabledIndices(profile: Profile, section: SectionKey): number[] {
  if (!PROFILE_ARRAY_SECTIONS.has(section)) return []
  const rows = (profile as unknown as Record<string, unknown>)[section]
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row, index) => {
    const record = row && typeof row === 'object' ? row as Record<string, unknown> : {}
    return record.enabled === false ? [] : [index]
  })
}

function routeCandidates(section: PageSection, profile: Profile): Array<{ section: SectionKey; index: number }> {
  const semantic = section.semanticCandidates.filter((candidate) => PROFILE_ARRAY_SECTIONS.has(candidate))
  if (semantic.length === 0) return []
  if (semantic.length === 1) {
    return enabledIndices(profile, semantic[0]).map((index) => ({ section: semantic[0], index }))
  }
  if (semantic.includes('experiences') && semantic.includes('projects')) {
    return (['experiences', 'projects'] as const).flatMap((candidate) =>
      enabledIndices(profile, candidate).map((index) => ({ section: candidate, index })))
  }

  // For an ambiguous multi-purpose block, prefer the first populated semantic section.
  // Combining unrelated arrays would silently route one page entry to the wrong profile row.
  const populated = semantic.find((candidate) => enabledIndices(profile, candidate).length > 0) ?? semantic[0]
  return enabledIndices(profile, populated).map((index) => ({ section: populated, index }))
}

export function buildEntryRoutes(model: PageModel, profile: Profile): EntryRouteIR[] {
  return model.sections.flatMap((section) => {
    const routes = routeCandidates(section, profile)
    return section.entries.flatMap((entry, position) => {
      const route = routes[position]
      if (!route) return []
      return [{
        pageSectionId: section.id,
        pageEntryId: entry.id,
        pageEntryIndex: entry.index,
        profileSection: route.section,
        profileIndex: route.index,
        factPrefix: `${route.section}[${route.index}]`,
      } satisfies EntryRouteIR]
    })
  })
}

export function buildSectionRouteIR(model: PageModel, profile: Profile, routes: EntryRouteIR[]): FormSectionIR[] {
  return model.sections.map((section) => ({
    sectionId: section.id,
    title: section.title,
    semanticCandidates: section.semanticCandidates,
    currentEntryCount: section.entries.length,
    desiredEntryCount: desiredEntryCount(section, profile),
    entryRoutes: routes.filter((route) => route.pageSectionId === section.id),
    fieldIds: [
      ...section.fields.map((field) => field.id),
      ...section.entries.flatMap((entry) => entry.fields.map((field) => field.id)),
    ],
  }))
}
