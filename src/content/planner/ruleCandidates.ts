import type { PageField, PageModel, PageSection } from '@/shared/pageModel'
import type { RuleCandidateV2, TransformId } from '@/shared/semanticPlan'
import type { SectionKey } from '@/shared/types'
import { norm } from '@/shared/util'
import { ALIASES } from '../aliases'

export type RuleCandidateIndex = Record<string, RuleCandidateV2[]>

function transformFor(fieldKey: string, field: PageField): TransformId {
  if (fieldKey === '__range') {
    return field.control.kind === 'date-range-parts' ? 'split-date-parts' : 'date-range'
  }
  if (field.control.kind === 'radio-group' || field.control.kind === 'checkbox' || field.control.kind.includes('select')) {
    return 'enum-normalize'
  }
  return 'identity'
}

function profilePath(section: SectionKey, entryIndex: number | undefined, fieldKey: string): string {
  if (section === 'selfEvaluation') return 'selfEvaluation.selfEvaluation'
  const repeat = ['educations', 'experiences', 'projects', 'papers', 'competitions', 'awards', 'studentWork', 'languages', 'itSkills', 'certificates', 'familyMembers'].includes(section)
  return repeat ? `${section}[${entryIndex ?? 0}].${fieldKey}` : `${section}.${fieldKey}`
}

function aliasScore(aliasRaw: string, field: PageField, sectionCompatible: boolean): { score: number; reason: string } {
  const alias = norm(aliasRaw)
  if (!alias) return { score: 0, reason: '' }
  const s = field.signals
  let score = 0
  let reason = ''
  const update = (next: number, why: string) => { if (next > score) { score = next; reason = why } }
  const label = norm(s.label)
  if (label === alias) update(0.92, `label 全等（${aliasRaw}）`)
  else if (label && (label.includes(alias) || alias.includes(label))) update(0.72, `label 包含（${aliasRaw}）`)

  for (const near of s.labelNear.map(norm)) {
    if (near === alias) update(0.75, `邻近文本全等（${aliasRaw}）`)
    else if (near && near.includes(alias)) update(0.55, `邻近文本包含（${aliasRaw}）`)
  }
  for (const source of [s.name, s.id, s.placeholder, s.ariaLabel, s.title].map(norm)) {
    if (source === alias) update(0.58, `属性全等（${aliasRaw}）`)
    else if (source && alias.length >= 2 && source.includes(alias)) update(0.43, `属性包含（${aliasRaw}）`)
  }
  if (score > 0 && sectionCompatible) score += 0.08
  return { score: Math.min(1, score), reason }
}

function candidatesForField(section: PageSection, field: PageField, entryIndex?: number): RuleCandidateV2[] {
  const candidates: RuleCandidateV2[] = []
  for (const semanticSection of section.semanticCandidates) {
    const currentSignal = norm([field.signals.label, ...field.signals.labelNear, field.signals.ariaLabel, field.signals.title].join(' '))
    if (field.control.kind === 'checkbox' && /至今|在读|在职|进行中/.test(currentSignal)
      && ['educations', 'experiences', 'projects', 'studentWork'].includes(semanticSection)) {
      candidates.push({
        fieldId: field.id,
        profilePath: profilePath(semanticSection, entryIndex, 'endDateIsNow'),
        score: 0.98,
        transform: 'enum-normalize',
        reason: '进行中开关语义',
      })
    }
    const aliases = ALIASES[semanticSection] ?? {}
    for (const [fieldKey, list] of Object.entries(aliases)) {
      let best = { score: 0, reason: '' }
      for (const alias of list) {
        const scored = aliasScore(alias, field, true)
        if (scored.score > best.score) best = scored
      }
      if (best.score < 0.35) continue
      candidates.push({
        fieldId: field.id,
        profilePath: profilePath(semanticSection, entryIndex, fieldKey),
        score: best.score,
        transform: transformFor(fieldKey, field),
        reason: best.reason,
      })
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 3)
}

export function generateRuleCandidateIndex(model: PageModel): RuleCandidateIndex {
  const index: RuleCandidateIndex = {}
  for (const section of model.sections) {
    for (const field of section.fields) index[field.id] = candidatesForField(section, field)
    for (const entry of section.entries) {
      for (const field of entry.fields) index[field.id] = candidatesForField(section, field, entry.index)
    }
  }
  return index
}
