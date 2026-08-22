import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageField, PageModel, PageSection } from '@/shared/pageModel'
import type { SemanticPlanItem } from '@/shared/semanticPlan'
import { createEmptyProfile } from '@/shared/storage'
import { buildSemanticPlannerBatches } from '../planner/batches'
import { buildProfileFactSummaries } from '../planner/profileFacts'
import { projectDateRange, projectValues } from '../planner/projection'
import { generateRuleCandidateIndex } from '../planner/ruleCandidates'
import { validateSemanticPlan } from '../planner/validatePlan'
import { discoverPageModel } from '../discover/pageModel'

const FIXTURE_DIR = path.join(process.cwd(), 'e2e', 'fixtures')

function loadFixture(name: string): void {
  const html = readFileSync(path.join(FIXTURE_DIR, name), 'utf8')
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  document.head.innerHTML = parsed.head.innerHTML
  document.body.innerHTML = parsed.body.innerHTML
}

function mockVisibleDom(): void {
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({
    0: {} as DOMRect,
    length: 1,
    item: () => null,
    [Symbol.iterator]: function* () { yield {} as DOMRect },
  } as DOMRectList)
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ display: 'block', visibility: 'visible', opacity: '1' } as CSSStyleDeclaration)
}

beforeEach(() => mockVisibleDom())
afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('V2 rule candidates', () => {
  it('keeps placeholder-containing aliases through section scoring and normalizes confidence', () => {
    loadFixture('moka-real-structure.html')
    const model = discoverPageModel(document, 'https://app.mokahr.com/campus-recruitment/example#/candidateHome/resume')
    const candidates = generateRuleCandidateIndex(model)
    const education = model.sections.find((section) => section.semanticCandidates.includes('educations'))
    const school = education?.entries[0].fields.find((field) => field.signals.placeholder === '请输入就读学校')
    const schoolCandidates = school ? candidates[school.id] : []

    expect(schoolCandidates.some((candidate) => candidate.profilePath === 'educations[0].school')).toBe(true)
    expect(schoolCandidates.every((candidate) => candidate.score >= 0 && candidate.score <= 1)).toBe(true)

    const current = education?.entries[0].fields.find((field) => field.control.kind === 'checkbox')
    expect(current && candidates[current.id].some((candidate) => candidate.profilePath === 'educations[0].endDateIsNow')).toBe(true)
  })
})

describe('full-section planner batching', () => {
  it('does not truncate fields after the first 60', () => {
    const base = createEmptyProfile('测试档案')
    base.basic.health = '健康'
    const sampleField: PageField = {
      id: 'template',
      signals: { label: '字段', labelNear: [], placeholder: '', name: '', id: '', ariaLabel: '', title: '', sectionTitle: '长分区' },
      control: {
        id: 'control_template', kind: 'text', root: { cssPath: 'body>input', index: 0, framePath: [], signature: 'root' },
        parts: [], options: [], required: false, disabled: false, readOnly: false, currentState: 'empty', commitStrategy: 'native-input',
      },
    }
    const fields = Array.from({ length: 75 }, (_, index) => ({
      ...sampleField,
      id: `field_${index}`,
      control: { ...sampleField.control, id: `control_${index}` },
    }))
    const section: PageSection = {
      id: 'section_long', title: '长分区', root: { cssPath: 'body>section', index: 0, framePath: [], signature: 'section' },
      semanticCandidates: ['basic'], entries: [], fields, actions: [],
    }
    const model: PageModel = {
      version: 2, url: 'https://example.com', title: 'test', capturedAt: 0,
      adapterId: 'generic', adapterMaturity: 'research', sections: [section], globalActions: [],
    }
    const batches = buildSemanticPlannerBatches(model, base, 'labels-only', {}, 80)
    expect(batches.flatMap((batch) => batch.fields)).toHaveLength(75)
  })
})

describe('privacy and plan validation', () => {
  it('masks direct identifiers while allowing non-sensitive values in with-values mode', () => {
    const profile = createEmptyProfile('测试档案')
    profile.basic.name = '示例用户'
    profile.basic.phone = '13800000000'
    profile.basic.idNumber = '110101200001010011'
    profile.educations[0].school = '示例大学'
    const facts = buildProfileFactSummaries(profile, 'with-values')

    expect(facts.find((fact) => fact.path === 'basic.phone')).toMatchObject({ masked: true, value: undefined })
    expect(facts.find((fact) => fact.path === 'basic.idNumber')).toMatchObject({ masked: true, value: undefined })
    expect(facts.find((fact) => fact.path === 'educations[0].school')).toMatchObject({ masked: false, value: '示例大学' })
  })

  it('rejects unknown paths and incompatible transforms', () => {
    loadFixture('moka-real-structure.html')
    const model = discoverPageModel(document, 'https://app.mokahr.com/campus-recruitment/example#/candidateHome/resume')
    const profile = createEmptyProfile('测试档案')
    profile.educations[0].school = '示例大学'
    const candidates = generateRuleCandidateIndex(model)
    const [batch] = buildSemanticPlannerBatches(model, profile, 'labels-only', candidates)
    const field = batch.fields[0]
    const items: SemanticPlanItem[] = [
      { fieldId: field.fieldId, decision: 'fill', profilePaths: ['unknown.path'], transform: 'identity', confidence: 0.9, reason: 'bad path' },
      { fieldId: field.fieldId, decision: 'fill', profilePaths: ['educations[0].school'], transform: 'split-date-parts', confidence: 0.8, reason: 'bad transform' },
    ]

    const validated = validateSemanticPlan(items, batch)
    expect(validated.accepted).toHaveLength(0)
    expect(validated.rejected).toHaveLength(2)
  })
})

describe('projection transforms', () => {
  it('projects the canonical structured range without reparsing a display string', () => {
    expect(projectDateRange({ startDate: '2022-09', endDate: '', endDateIsNow: true })).toEqual({
      kind: 'parts',
      parts: {
        'start-year': '2022',
        'start-month': '09',
        'end-year': '',
        'end-month': '',
        'current-toggle': '是',
      },
    })
  })

  it.each(['2022-09 ~ 至今', '2022-09 至今', '2022年9月至今'])(
    'splits an ongoing date range without consuming the current marker: %s',
    (value) => {
      expect(projectValues('split-date-parts', [value])).toEqual({
        kind: 'parts',
        parts: {
          'start-year': '2022',
          'start-month': '09',
          'end-year': '',
          'end-month': '',
          'current-toggle': '是',
        },
      })
    },
  )

  it('splits a completed date range into start and end parts', () => {
    expect(projectValues('split-date-parts', ['2022-09 ～ 2024-06'])).toEqual({
      kind: 'parts',
      parts: {
        'start-year': '2022',
        'start-month': '09',
        'end-year': '2024',
        'end-month': '06',
        'current-toggle': '否',
      },
    })
  })
})
