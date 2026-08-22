import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProfile } from '@/shared/storage'
import { buildFormPageIR } from '../agent/componentIr'
import { discoverPageModel } from '../discover/pageModel'
import { buildEntryRoutes } from '../planner/entryRoutes'
import { generateRuleCandidateIndex } from '../planner/ruleCandidates'

const FIXTURES = path.join(process.cwd(), 'e2e', 'fixtures')

function load(name: string): void {
  const html = readFileSync(path.join(FIXTURES, name), 'utf8')
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  document.body.innerHTML = parsed.body.innerHTML
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({
    0: {} as DOMRect,
    length: 1,
    item: () => null,
    [Symbol.iterator]: function* () { yield {} as DOMRect },
  } as DOMRectList)
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    display: 'block', visibility: 'visible', opacity: '1',
  } as CSSStyleDeclaration)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('sanitized component IR', () => {
  it('exposes exact date slots and executable select interaction without raw DOM or values', () => {
    load('moka-real-structure.html')
    const model = discoverPageModel(document, 'https://app.mokahr.com/resume?token=private')
    const profile = createEmptyProfile('测试档案')
    profile.basic.idNumber = '110101199901010019'
    profile.educations[0].school = '示例大学'
    const ir = buildFormPageIR(model, profile, 'with-values', document)
    const date = ir.fields.find((field) => field.controlKind === 'date-range-parts')
    const school = ir.fields.find((field) => field.labels.includes('学校名称'))
    const serialized = JSON.stringify(ir)

    expect(date?.parts.map((part) => [part.role, part.format])).toEqual([
      ['start-year', 'YYYY'], ['start-month', 'MM'], ['end-year', 'YYYY'], ['end-month', 'MM'], ['current-toggle', 'boolean'],
    ])
    expect(school?.parts.some((part) => part.interaction === 'open-overlay-click-option')).toBe(true)
    expect(school?.constraints).toMatchObject({ mustCommitOption: true, successEvidence: 'selected-state' })
    expect(serialized).not.toContain('cssPath')
    expect(serialized).not.toContain('outerHTML')
    expect(serialized).not.toContain('110101199901010019')
    expect(serialized).not.toContain('token=private')
  })

  it('synthesizes allow-listed component HTML instead of forwarding page markup', () => {
    document.body.innerHTML = `<section><h2>个人信息</h2><div class="semantic-row secret-token">
      <span class="semantic-label">证件号码</span>
      <select data-secret="do-not-send"><option>请选择</option><option>身份证</option></select>
      <input value="320902200208141033" onclick="submitResume()">
    </div></section>`
    const profile = createEmptyProfile('测试档案')
    const model = discoverPageModel(document, 'https://example.com/resume')
    const ir = buildFormPageIR(model, profile, 'with-values', document)
    const html = ir.fields.map((field) => field.componentHtml).join('')

    expect(html).toContain('<field')
    expect(html).toContain('interaction="native-select"')
    expect(html).not.toContain('data-secret')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('320902200208141033')
    expect(html).not.toContain('secret-token')
  })
})

describe('repeat entry routes', () => {
  it('maps every page entry to the original enabled profile index', () => {
    load('moka-real-structure.html')
    const profile = createEmptyProfile('测试档案')
    profile.educations[0].school = '第一所学校'
    profile.educations.push({ ...profile.educations[0], enabled: false, school: '已禁用学校' })
    profile.educations.push({ ...profile.educations[0], enabled: true, school: '第二所学校' })
    const panel = document.querySelector('.resume-panel')
    const card = document.querySelector('.education-card')?.cloneNode(true)
    if (panel && card) panel.appendChild(card)
    const model = discoverPageModel(document, 'https://app.mokahr.com/resume')
    const education = model.sections.find((section) => section.semanticCandidates.includes('educations'))
    const routes = buildEntryRoutes(model, profile).filter((route) => route.pageSectionId === education?.id)

    expect(routes.map((route) => route.factPrefix)).toEqual(['educations[0]', 'educations[2]'])
    const secondField = education?.entries[1].fields.find((field) => field.signals.label === '学校名称')
    expect(secondField && generateRuleCandidateIndex(model, profile)[secondField.id][0].profilePath).toBe('educations[2].school')
  })

  it('routes a merged experience/project section in deterministic profile order', () => {
    load('kuma-real-structure.html')
    const profile = createEmptyProfile('测试档案')
    profile.experiences.push({
      enabled: true, kind: 'internship', company: '示例公司', city: '', department: '', title: '',
      startDate: '2024-01', endDate: '2024-06', endDateIsNow: false, description: '', achievements: '', skills: [],
    })
    profile.projects.push({
      enabled: true, name: '示例项目一', role: '', startDate: '2024-07', endDate: '2024-12',
      endDateIsNow: false, url: '', description: '', contribution: '', achievements: '', techStack: [],
    })
    profile.projects.push({ ...profile.projects[0], name: '示例项目二' })
    const model = discoverPageModel(document, 'https://talent.alibaba.com/personal/campus-resume')
    const merged = model.sections.find((section) => section.semanticCandidates.includes('experiences') && section.semanticCandidates.includes('projects'))
    if (!merged) throw new Error('missing merged section')
    while (merged.entries.length < 3) merged.entries.push({ ...merged.entries[0], id: `${merged.entries[0].id}_${merged.entries.length}`, index: merged.entries.length })
    const routes = buildEntryRoutes(model, profile).filter((route) => route.pageSectionId === merged.id)

    expect(routes.map((route) => route.factPrefix)).toEqual(['experiences[0]', 'projects[0]', 'projects[1]'])
  })
})
