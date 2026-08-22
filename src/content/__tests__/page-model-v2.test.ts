import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sanitizeCaptureUrl, sanitizePageModel } from '../capture/sanitize'
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
    const education = model.sections.find((section) => section.semanticCandidates.includes('educations'))
    expect(education?.entries).toHaveLength(1)
    const fields = education?.entries[0].fields ?? []
    expect(fields.some((field) => field.signals.label === '学校名称')).toBe(true)
    expect(fields.find((field) => field.control.kind === 'date-range-parts')?.control.parts).toHaveLength(5)
    expect(fields.find((field) => field.control.kind === 'date-range-parts')?.control.parts.some((part) => part.role === 'current-toggle')).toBe(true)
    expect(education?.actions.some((action) => action.kind === 'add' && action.safety === 'automatic')).toBe(true)
    expect(model.globalActions.some((action) => action.kind === 'save' && action.safety === 'forbidden')).toBe(true)
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
