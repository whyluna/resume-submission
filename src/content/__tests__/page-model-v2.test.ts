import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sanitizeCaptureUrl, sanitizePageModel } from '../capture/sanitize'
import { discoverPageModel } from '../discover/pageModel'
import { prepareRepeatEntries } from '../adapters/repeatEntries'
import { createEmptyProfile } from '@/shared/storage'
import { generateRuleCandidateIndex } from '../planner/ruleCandidates'
import { executeControl } from '../executorV2/controls'
import { projectDateRange } from '../planner/projection'

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
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    display: 'block',
    visibility: 'visible',
    opacity: '1',
  } as CSSStyleDeclaration)
}

beforeEach(() => mockVisibleDom())

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('PageModel V2 discovery', () => {
  it('discovers Moka semantic rows, entry cards and split date parts', () => {
    loadFixture('moka-real-structure.html')
    const model = discoverPageModel(document, 'https://app.mokahr.com/campus-recruitment/example#/candidateHome/resume')

    expect(model.adapterId).toBe('moka')
    expect(model.adapterMaturity).toBe('fixture-verified')
    const education = model.sections.find((section) => section.semanticCandidates.includes('educations'))
    expect(education?.entries).toHaveLength(1)
    const fields = education?.entries[0].fields ?? []
    expect(fields.some((field) => field.signals.label === '学校名称')).toBe(true)
    expect(fields.find((field) => field.signals.label === '学校名称')?.control.kind).toBe('combobox')
    expect(fields.find((field) => field.control.kind === 'date-range-parts')?.control.parts).toHaveLength(5)
    expect(fields.find((field) => field.control.kind === 'date-range-parts')?.control.parts.some((part) => part.role === 'current-toggle')).toBe(true)
    expect(education?.actions.some((action) => action.kind === 'add' && action.safety === 'automatic')).toBe(true)
    const language = model.sections.find((section) => section.semanticCandidates.includes('languages'))
    expect(language?.entries).toHaveLength(1)
    expect(language?.entries[0].fields).toHaveLength(2)
    expect(model.globalActions.some((action) => action.kind === 'save' && action.safety === 'forbidden')).toBe(true)
  })

  it('adds only missing Moka entries and stays idempotent without clicking save', async () => {
    loadFixture('moka-real-structure.html')
    let saveClicks = 0
    document.querySelector('.save-resume')?.addEventListener('click', () => saveClicks++)
    const add = document.querySelector('.resume-panel button')
    add?.addEventListener('click', () => {
      const card = document.querySelector('.education-card')?.cloneNode(true)
      if (card) document.querySelector('.resume-panel')?.appendChild(card)
    })
    const profile = createEmptyProfile('测试档案')
    profile.educations.push({ ...profile.educations[0], school: '第二所学校' })
    const initial = discoverPageModel(document, 'https://app.mokahr.com/campus-recruitment/example#/candidateHome/resume')
    const first = await prepareRepeatEntries(initial, profile, document)
    expect(first.added).toBe(1)
    expect(first.model.sections.find((section) => section.semanticCandidates.includes('educations'))?.entries).toHaveLength(2)
    const second = await prepareRepeatEntries(first.model, profile, document)
    expect(second.added).toBe(0)
    expect(saveClicks).toBe(0)
  })

  it('discovers Kuma comboboxes, date ranges and merged experience/project semantics', () => {
    loadFixture('kuma-real-structure.html')
    const model = discoverPageModel(document, 'https://talent.alibaba.com/personal/campus-resume?lang=zh')

    expect(model.adapterId).toBe('kuma')
    const education = model.sections.find((section) => section.semanticCandidates.includes('educations'))
    expect(education?.entries[0].fields.some((field) => field.control.kind === 'combobox')).toBe(true)
    expect(education?.entries[0].fields.some((field) => field.control.kind === 'date-range')).toBe(true)
    expect(education?.actions.some((action) => action.kind === 'add' && action.safety === 'automatic')).toBe(true)
    expect(education?.actions.some((action) => action.kind === 'save' && action.safety === 'forbidden')).toBe(true)

    const merged = model.sections.find((section) => section.title === '实习/项目经历')
    expect(merged?.semanticCandidates).toEqual(['experiences', 'projects'])
  })

  it('discovers Dayee WT dates and add links while forbidding save/submit actions', () => {
    loadFixture('dayee-wt-real-structure.html')
    const model = discoverPageModel(document, 'https://job.example.com/wt/tenant/web/index#/resume')

    expect(model.adapterId).toBe('dayee-wt')
    const education = model.sections.find((section) => section.semanticCandidates.includes('educations'))
    expect(education?.entries[0].fields.filter((field) => field.control.kind === 'date-single')).toHaveLength(2)
    expect(education?.actions.some((action) => action.kind === 'add' && action.safety === 'automatic')).toBe(true)
    expect(education?.actions.some((action) => action.kind === 'save' && action.safety === 'forbidden')).toBe(true)
    expect(model.globalActions.some((action) => action.kind === 'submit' && action.safety === 'forbidden')).toBe(true)
  })

  it('uses the nearest control-bearing ancestor when a real-site section has opaque classes', () => {
    document.body.innerHTML = `
      <div class="opaque-shell-7f3a">
        <div class="opaque-title-4b2c">教育背景</div>
        <div><label>学校名称</label><input placeholder="请输入学校"></div>
      </div>`
    const model = discoverPageModel(document, 'https://app.mokahr.com/campus-recruitment/example#/candidateHome/resume')
    const education = model.sections.find((section) => section.semanticCandidates.includes('educations'))
    expect(education).toBeDefined()
    expect(education?.entries[0].fields).toHaveLength(1)
  })

  it('models same-label document type and number controls as a compound row', () => {
    document.body.innerHTML = `<section><h2>个人信息</h2>
      <div class="semantic-row"><span class="semantic-label">证件号码</span>
        <select><option value="">请选择</option><option>身份证</option><option>护照</option></select>
        <input type="text">
      </div>
    </section>`
    const model = discoverPageModel(document, 'https://example.com/resume')
    const fields = model.sections[0].fields
    expect(fields).toHaveLength(2)
    expect(fields.map((field) => field.compoundIndex)).toEqual([0, 1])
    expect(fields[0].compoundGroupId).toBe(fields[1].compoundGroupId)
    const candidates = generateRuleCandidateIndex(model, createEmptyProfile('测试档案'))
    expect(candidates[fields[0].id][0].profilePath).toBe('basic.idType')
    expect(candidates[fields[1].id][0].profilePath).toBe('basic.idNumber')
  })

  it('groups and executes opaque four-part selects as one semantic date range', async () => {
    const options = (values: string[]) => `<select><option value="">请选择</option>${values.map((value) => `<option>${value}</option>`).join('')}</select>`
    document.body.innerHTML = `<section><h2>教育背景</h2>
      <div class="semantic-row"><span class="semantic-label">就读时间</span>
        ${options(['2021', '2022'])}${options(['08', '09'])}${options(['2025', '2026'])}${options(['05', '06'])}
      </div>
    </section>`
    const model = discoverPageModel(document, 'https://unknown.example/resume')
    const fields = model.sections[0].entries[0].fields
    expect(fields).toHaveLength(1)
    expect(fields[0].control.kind).toBe('date-range-parts')
    expect(fields[0].control.parts.map((part) => part.role)).toEqual(['start-year', 'start-month', 'end-year', 'end-month'])
    expect(fields[0].control.parts.every((part) => part.controlKind === 'native-select')).toBe(true)
    const executed = await executeControl({
      field: fields[0],
      value: projectDateRange({ startDate: '2022-09', endDate: '2026-06', endDateIsNow: false }),
    }, document)
    expect(executed.verified).toBe(true)
    expect(Array.from(document.querySelectorAll('select')).map((select) => select.value)).toEqual(['2022', '09', '2026', '06'])
  })

  it('groups same-label date controls across opaque nested cells and rejects field-label pseudo sections', () => {
    const select = (values: string[]) => `<div class="opaque-cell form-item"><select><option value="">请选择</option>${values.map((value) => `<option>${value}</option>`).join('')}</select></div>`
    document.body.innerHTML = `<section class="resume-section"><h2>教育背景</h2><div class="opaque-date-row">
      <div class="field-title">就读时间</div>
      ${select(['2021', '2022'])}${select(['08', '09'])}${select(['2025', '2026'])}${select(['05', '06'])}
    </div></section>
    <section class="resume-section"><h2>项目经验</h2><div class="form-item"><div class="module-title">项目名称</div><input></div></section>
    <section class="resume-section"><h2>个人信息</h2><div class="form-item"><div class="module-title">工作经验</div><select><option>无</option></select></div></section>`
    const model = discoverPageModel(document, 'https://unknown.example/resume')
    expect(model.sections.map((section) => section.title)).toEqual(['教育背景', '项目经验', '个人信息'])
    const education = model.sections.find((section) => section.title === '教育背景')
    expect(education?.entries[0].fields).toHaveLength(1)
    expect(education?.entries[0].fields[0].control.kind).toBe('date-range-parts')
  })
})

describe('capture sanitization', () => {
  it('redacts query values and token-like route segments', () => {
    const sanitized = sanitizeCaptureUrl('https://example.com/resume/abcdefghijklmnopqrstuvwxyz012345?candidateId=secret#view/abcdefghijklmnopqrstuvwxyz012345')
    expect(sanitized).not.toContain('secret')
    expect(sanitized).not.toContain('abcdefghijklmnopqrstuvwxyz012345')
    expect(decodeURIComponent(sanitized)).toContain(':redacted')
    expect(decodeURIComponent(sanitized)).toContain(':token')
  })

  it('removes accidental personal values from captured semantic text', () => {
    loadFixture('moka-real-structure.html')
    const model = discoverPageModel(document, 'https://example.com/resume?token=private')
    model.sections[0].entries[0].fields[0].signals.labelNear = [
      '测试用户 test@example.com',
      '联系电话 13800000000',
      '证件号码 110101200001010011',
    ]

    const serialized = JSON.stringify(sanitizePageModel(model))
    expect(serialized).not.toContain('test@example.com')
    expect(serialized).not.toContain('13800000000')
    expect(serialized).not.toContain('110101200001010011')
    expect(serialized).toContain('[redacted-email]')
    expect(serialized).toContain('[redacted-phone]')
    expect(serialized).toContain('[redacted-id]')
  })
})
