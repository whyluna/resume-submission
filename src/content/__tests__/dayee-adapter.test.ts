import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProfile } from '@/shared/storage'
import { DEFAULT_SETTINGS } from '@/shared/storage'
import { planPageSemantics } from '@/background/llmPlanner'
import { discoverPageModel } from '../discover/pageModel'
import { executeSemanticPlan } from '../executorV2/executePlan'
import { buildSemanticPlannerBatches } from '../planner/batches'

beforeEach(() => {
  const html = readFileSync(path.join(process.cwd(), 'e2e/fixtures/dayee-wt-real-structure.html'), 'utf8')
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  document.body.innerHTML = parsed.body.innerHTML
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({ length: 1, item: () => null, [Symbol.iterator]: function* () {} } as DOMRectList)
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ display: 'block', visibility: 'visible', opacity: '1' } as CSSStyleDeclaration)
})

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('Dayee WT adapter', () => {
  it('fills dates, text and selectpicker through verified execution without safe-action violations', async () => {
    let forbiddenClicks = 0
    document.querySelectorAll('.save-section,.save-all,.submit-all').forEach((button) => button.addEventListener('click', () => forbiddenClicks++))
    const model = discoverPageModel(document, 'https://job.example.com/wt/tenant/web/index#/resume')
    expect(model.adapterId).toBe('dayee-wt')
    expect(model.adapterMaturity).toBe('fixture-verified')
    const profile = createEmptyProfile('测试档案')
    Object.assign(profile.educations[0], {
      school: '示例大学', education: '本科', startDate: '2022-09', endDate: '2026-06', endDateIsNow: false,
    })
    profile.awards = [{ enabled: true, name: '示例荣誉', level: '校级', date: '2025-06' }]
    const planned = await planPageSemantics(model, profile, { ...DEFAULT_SETTINGS, privacyMode: 'off' })
    expect(planned.accepted.flatMap((item) => item.profilePaths).sort()).toEqual([
      'awards[0].date', 'awards[0].name', 'educations[0].education', 'educations[0].endDate',
      'educations[0].school', 'educations[0].startDate',
    ].sort())
    const report = await executeSemanticPlan(model, profile, planned.accepted, document)
    expect(report.failed).toBe(0)
    expect(report.verified).toBeGreaterThanOrEqual(6)
    expect((document.querySelector('.startDate') as HTMLInputElement).value).toBe('2022-09')
    expect((document.querySelector('.endDate') as HTMLInputElement).value).toBe('2026-06')
    expect((document.querySelector('select.selectpicker') as HTMLSelectElement).selectedOptions[0].textContent).toBe('本科')
    expect(forbiddenClicks).toBe(0)
  })

  it('models and batches a 120-control WT section without truncating after 60 or 80', () => {
    const section = document.createElement('section')
    section.className = 'resume-section'
    section.innerHTML = `<h2>基本信息</h2>${Array.from({ length: 120 }, (_, index) =>
      `<div class="resume-row"><div class="field-title">扩展字段 ${index + 1}</div><div class="ipt-item"><input type="text"></div></div>`).join('')}`
    document.querySelector('main')?.appendChild(section)
    const model = discoverPageModel(document, 'https://job.example.com/wt/tenant/web/index#/resume')
    const basic = model.sections.find((item) => item.semanticCandidates.includes('basic'))
    expect(basic?.fields).toHaveLength(120)
    const batches = buildSemanticPlannerBatches(model, createEmptyProfile('测试档案'), 'labels-only', {}, 80)
      .filter((batch) => batch.sectionId === basic?.id)
    expect(batches).toHaveLength(2)
    expect(batches.flatMap((batch) => batch.fields)).toHaveLength(120)
  })
})
