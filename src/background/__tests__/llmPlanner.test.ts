import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageField, PageModel } from '@/shared/pageModel'
import type { Settings } from '@/shared/types'
import { createEmptyProfile } from '@/shared/storage'
import { chat } from '../llm'
import { planPageSemantics } from '../llmPlanner'

vi.mock('../llm', () => ({
  chat: vi.fn(),
  parseJsonLoose: (value: string) => JSON.parse(value),
}))

const settings: Settings = {
  apiBaseUrl: 'https://example.invalid/v1',
  apiKey: 'test-key',
  model: 'test-model',
  privacyMode: 'labels-only',
  autoPager: false,
}

function field(id: string, label: string): PageField {
  return {
    id,
    signals: { label, labelNear: [], placeholder: '', name: '', id: '', ariaLabel: '', title: '', sectionTitle: '基本信息' },
    control: {
      id: `control_${id}`,
      kind: 'text',
      root: { cssPath: `#${id}`, index: 0, framePath: [], signature: id },
      parts: [], options: [], required: false, disabled: false, readOnly: false,
      currentState: 'empty', commitStrategy: 'native-input',
    },
  }
}

describe('full-section LLM planner', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reviews both rule-matched and unmatched fields in the same section', async () => {
    const model: PageModel = {
      version: 2,
      url: 'https://example.com/resume',
      title: 'test',
      capturedAt: 0,
      adapterId: 'generic',
      adapterMaturity: 'research',
      sections: [{
        id: 'section_basic',
        title: '基本信息',
        root: { cssPath: '#basic', index: 0, framePath: [], signature: 'basic' },
        semanticCandidates: ['basic'],
        entries: [],
        fields: [field('known', '健康状况'), field('long-tail', '长尾健康字段')],
        actions: [],
      }],
      globalActions: [],
    }
    const profile = createEmptyProfile('测试档案')
    profile.basic.health = '健康'

    vi.mocked(chat).mockImplementation(async (_settings, messages) => {
      const payload = JSON.parse(messages[1].content)
      expect(payload.batch.fields).toHaveLength(2)
      expect(payload.batch.fields[0].ruleCandidates.length).toBeGreaterThan(0)
      expect(payload.batch.fields[1].ruleCandidates).toHaveLength(0)
      return JSON.stringify(payload.batch.fields.map((item: { fieldId: string }) => ({
        fieldId: item.fieldId,
        decision: 'fill',
        profilePaths: ['basic.health'],
        transform: 'identity',
        confidence: 0.9,
        reason: '同一分区语义复审',
      })))
    })

    const result = await planPageSemantics(model, profile, settings)
    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.accepted.map((item) => item.fieldId)).toEqual(['known', 'long-tail'])
    expect(result.rejected).toHaveLength(0)
  })

  it('keeps high-confidence rule candidates executable when LLM is off', async () => {
    const model: PageModel = {
      version: 2, url: 'https://example.com', title: 'test', capturedAt: 0, adapterId: 'generic', adapterMaturity: 'research',
      sections: [{
        id: 'basic', title: '基本信息', root: { cssPath: '#basic', index: 0, framePath: [], signature: 'basic' },
        semanticCandidates: ['basic'], entries: [], fields: [field('health', '健康状况')], actions: [],
      }], globalActions: [],
    }
    const profile = createEmptyProfile('测试档案')
    profile.basic.health = '健康'
    const result = await planPageSemantics(model, profile, { ...settings, privacyMode: 'off' })
    expect(chat).not.toHaveBeenCalled()
    expect(result.accepted).toMatchObject([{ fieldId: 'health', profilePaths: ['basic.health'], decision: 'keep-rule' }])
  })

  it('never serializes profile values in labels-only mode', async () => {
    const model: PageModel = {
      version: 2, url: 'https://example.com', title: 'test', capturedAt: 0, adapterId: 'generic', adapterMaturity: 'research',
      sections: [{
        id: 'basic', title: '基本信息', root: { cssPath: '#basic', index: 0, framePath: [], signature: 'basic' },
        semanticCandidates: ['basic'], entries: [], fields: [field('phone', '手机')], actions: [],
      }], globalActions: [],
    }
    const profile = createEmptyProfile('测试档案')
    profile.basic.name = '绝不外发的姓名'
    profile.basic.phone = '13899998888'
    profile.basic.idNumber = '110101199901010019'
    vi.mocked(chat).mockResolvedValue('[]')
    await planPageSemantics(model, profile, settings)
    const request = vi.mocked(chat).mock.calls[0][1][1].content
    expect(request).not.toContain(profile.basic.name)
    expect(request).not.toContain(profile.basic.phone)
    expect(request).not.toContain(profile.basic.idNumber)
    expect(JSON.parse(request).batch.profileFacts.every((fact: { value?: string }) => fact.value === undefined)).toBe(true)
  })
})
