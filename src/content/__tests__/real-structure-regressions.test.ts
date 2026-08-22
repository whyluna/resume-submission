import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldEl, Profile, Settings } from '@/shared/types'
import { createEmptyProfile } from '@/shared/storage'
import { llmReviewFields, type ReviewField } from '../llmFallback'
import { matchFieldsInGroup } from '../matcher'
import { scanDocument } from '../scanner'

// M0 pins known real-page gaps with `it.fails`: the suite passes only while those assertions
// still fail. Each implementation fix must convert its case to a normal `it` regression test.
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

beforeEach(() => {
  mockVisibleDom()
})

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('sanitized live-structure fixtures', () => {
  it('does not mistake sidebar navigation for Moka form sections', () => {
    loadFixture('moka-real-structure.html')
    const snapshot = scanDocument()
    expect(snapshot.groups.filter((group) => group.sectionKey === 'educations')).toHaveLength(1)
    expect(snapshot.groups.filter((group) => group.sectionKey === 'projects')).toHaveLength(1)
  })

  it.fails('extracts a deeply nested Moka field label from its semantic row', () => {
    loadFixture('moka-real-structure.html')
    const education = scanDocument().groups.find((group) => group.sectionKey === 'educations')
    const school = education?.fields.find((field) => field.signals.placeholder === '请输入就读学校')
    expect(school?.signals.label).toBe('学校名称')
  })

  it.fails('keeps a placeholder-containing alias until section compatibility is scored', () => {
    loadFixture('moka-real-structure.html')
    const education = scanDocument().groups.find((group) => group.sectionKey === 'educations')
    expect(education).toBeDefined()
    const school = education?.fields.find((field) => field.signals.placeholder === '请输入就读学校')
    const match = matchFieldsInGroup(education!).find((item) => item.field === school)
    expect(match?.fieldKey).toBe('school')
  })

  it.fails('models Moka start/end year and month inputs as a date control', () => {
    loadFixture('moka-real-structure.html')
    const education = scanDocument().groups.find((group) => group.sectionKey === 'educations')
    const dateParts = education?.fields.filter((field) => ['年', '月'].includes(field.signals.placeholder)) ?? []
    expect(dateParts).toHaveLength(4)
    expect(dateParts.every((field) => field.control === 'date')).toBe(true)
  })

  it.fails('recognizes Kuma select2 as a custom select control', () => {
    loadFixture('kuma-real-structure.html')
    const education = scanDocument().groups.find((group) => group.sectionKey === 'educations')
    expect(education?.fields.some((field) => field.control === 'customselect')).toBe(true)
  })

  it.fails('recognizes Kuma text-and-icon add actions', () => {
    loadFixture('kuma-real-structure.html')
    const education = scanDocument().groups.find((group) => group.sectionKey === 'educations')
    expect(education?.buttons.some((button) => button.kind === 'add')).toBe(true)
  })

  it.fails('recognizes Dayee dayType inputs as date controls', () => {
    loadFixture('dayee-wt-real-structure.html')
    const education = scanDocument().groups.find((group) => group.sectionKey === 'educations')
    const dates = education?.fields.filter((field) => field.el.classList.contains('dayType')) ?? []
    expect(dates.length).toBeGreaterThanOrEqual(2)
    expect(dates.every((field) => field.control === 'date')).toBe(true)
  })

  it.fails('recognizes Dayee add-more links without button classes', () => {
    loadFixture('dayee-wt-real-structure.html')
    const education = scanDocument().groups.find((group) => group.sectionKey === 'educations')
    expect(education?.buttons.some((button) => button.kind === 'add')).toBe(true)
  })

  it('does not classify section save controls as add buttons', () => {
    loadFixture('dayee-wt-real-structure.html')
    const allButtons = scanDocument().groups.flatMap((group) => group.buttons)
    expect(allButtons.some((button) => /保存|暂存/.test(button.text) && button.kind === 'add')).toBe(false)
  })
})

describe('LLM review batching', () => {
  it.fails('sends every field in a section instead of truncating at 60', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, plan: [], message: 'ok' })
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    const ctxs: ReviewField[] = Array.from({ length: 75 }, (_, i) => {
      const el = document.createElement('input')
      const field: FieldEl = {
        ref: { cssPath: `body>input:nth-of-type(${i + 1})`, index: 0 },
        control: 'text',
        el,
        signals: {
          label: `测试字段${i + 1}`,
          labelNear: [],
          name: `field_${i + 1}`,
          id: '',
          placeholder: '',
          ariaLabel: '',
          title: '',
          sectionText: '测试分区',
          required: false,
        },
        signature: `sig_${i + 1}`,
      }
      return { field, sectionKey: 'basic', slotHint: '测试分区' }
    })
    const settings: Settings = {
      apiBaseUrl: 'https://example.invalid/v1',
      apiKey: 'test-key',
      model: 'test-model',
      privacyMode: 'labels-only',
      agentMode: true,
      autoPager: false,
    }

    await llmReviewFields(ctxs, createEmptyProfile('测试档案') as Profile, settings)

    const request = sendMessage.mock.calls[0]?.[0] as { fields?: unknown[] }
    expect(request.fields).toHaveLength(75)
  })
})
