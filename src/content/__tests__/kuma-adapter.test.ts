import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, createEmptyProfile } from '@/shared/storage'
import { planPageSemantics } from '@/background/llmPlanner'
import { discoverPageModel } from '../discover/pageModel'
import { executeSemanticPlan } from '../executorV2/executePlan'
import { generateRuleCandidateIndex } from '../planner/ruleCandidates'

beforeEach(() => {
  const html = readFileSync(path.join(process.cwd(), 'e2e/fixtures/kuma-real-structure.html'), 'utf8')
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  document.body.innerHTML = parsed.body.innerHTML
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({ length: 1, item: () => null, [Symbol.iterator]: function* () {} } as DOMRectList)
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ display: 'block', visibility: 'visible', opacity: '1' } as CSSStyleDeclaration)
})

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

function bindKumaSelect(root: Element, optionText: string): void {
  const input = root.querySelector('input') as HTMLInputElement
  const dropdown = document.createElement('div')
  dropdown.className = 'kuma-select2-dropdown'
  dropdown.style.display = 'none'
  const option = document.createElement('div')
  option.setAttribute('role', 'option')
  option.textContent = optionText
  dropdown.appendChild(option)
  document.body.appendChild(dropdown)
  input.addEventListener('input', () => { dropdown.style.display = 'block' })
  option.addEventListener('click', () => { (root as HTMLElement).dataset.value = optionText; dropdown.style.display = 'none' })
}

describe('Kuma adapter', () => {
  it('verifies Kuma search selections and readonly date ranges without save/submit clicks', async () => {
    const selects = Array.from(document.querySelectorAll('.kuma-select2'))
    bindKumaSelect(selects[0], '本科')
    bindKumaSelect(selects[1], '示例大学')
    let forbiddenClicks = 0
    document.querySelectorAll('.kuma-button,.choose-job').forEach((button) => button.addEventListener('click', () => forbiddenClicks++))
    const model = discoverPageModel(document, 'https://talent.alibaba.com/personal/campus-resume?lang=zh')
    expect(model.adapterId).toBe('kuma')
    expect(model.adapterMaturity).toBe('fixture-verified')
    expect(model.sections.find((section) => section.title === '实习/项目经历')?.semanticCandidates).toEqual(['experiences', 'projects'])
    const profile = createEmptyProfile('测试档案')
    Object.assign(profile.educations[0], { school: '示例大学', education: '本科', startDate: '2022-09', endDate: '2026-06' })
    const planned = await planPageSemantics(model, profile, { ...DEFAULT_SETTINGS, privacyMode: 'off' })
    const report = await executeSemanticPlan(model, profile, planned.accepted, document)
    expect(report.failed).toBe(0)
    expect(report.verified).toBe(3)
    expect((selects[0] as HTMLElement).dataset.value).toBe('本科')
    expect((selects[1] as HTMLElement).dataset.value).toBe('示例大学')
    expect((document.querySelector('.kuma-date-uxform-field-cascade input:first-child') as HTMLInputElement).value).toBe('2022-09')
    expect((document.querySelector('.kuma-date-uxform-field-cascade input:last-child') as HTMLInputElement).value).toBe('2026-06')
    expect(forbiddenClicks).toBe(0)
  })

  it('routes merged experience/project entry indices to separate profile arrays', () => {
    const mergedSection = Array.from(document.querySelectorAll('.kuma-resume-section'))
      .find((section) => section.textContent?.includes('实习/项目经历'))
    const card = mergedSection?.querySelector('.kuma-experience-card')
    if (card) mergedSection?.insertBefore(card.cloneNode(true), mergedSection.querySelector('.kuma-add-action'))
    const model = discoverPageModel(document, 'https://talent.alibaba.com/personal/campus-resume?lang=zh')
    const profile = createEmptyProfile('测试档案')
    profile.experiences = [{
      enabled: true, kind: 'internship', company: '示例公司', city: '', department: '', title: '', startDate: '', endDate: '', endDateIsNow: false,
      description: '实习描述', achievements: '', skills: [],
    }]
    profile.projects = [{
      enabled: true, name: '示例项目', role: '', startDate: '', endDate: '', endDateIsNow: false,
      url: '', description: '项目描述', contribution: '', achievements: '', techStack: [],
    }]
    const candidates = generateRuleCandidateIndex(model, profile)
    const merged = model.sections.find((section) => section.title === '实习/项目经历')
    const descriptions = merged?.entries.map((entry) => entry.fields.find((field) => field.signals.label === '工作描述')) ?? []
    expect(descriptions).toHaveLength(2)
    expect(candidates[descriptions[0]!.id].some((candidate) => candidate.profilePath === 'experiences[0].description')).toBe(true)
    expect(candidates[descriptions[1]!.id].some((candidate) => candidate.profilePath === 'projects[0].description')).toBe(true)
  })
})
