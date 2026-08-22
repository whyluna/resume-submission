import type { PageModel } from './pageModel'
import type { Profile } from './types'

/** Cross-platform data projection performed before semantic planning and local execution. */
export function projectProfileForPage(profile: Profile, model: PageModel): Profile {
  const hasPaperSection = model.sections.some((section) => section.semanticCandidates.includes('papers'))
  const papers = (profile.papers ?? []).filter((paper) => paper.enabled !== false)
  if (hasPaperSection || papers.length === 0) return profile
  return {
    ...profile,
    projects: [
      ...(profile.projects ?? []).filter((project) => project.enabled !== false),
      ...papers.map((paper) => ({
        enabled: true,
        name: paper.title || '论文',
        role: paper.authorOrder,
        startDate: '',
        endDate: paper.publishDate,
        endDateIsNow: false,
        url: paper.link,
        description: [paper.description, paper.venue ? `发表于 ${paper.venue}` : '', paper.indexed ? `检索：${paper.indexed}` : ''].filter(Boolean).join('；'),
        contribution: '',
        achievements: '',
        techStack: [],
      })),
    ],
  }
}
