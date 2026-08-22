import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageModel } from '@/shared/pageModel'
import { DEFAULT_SETTINGS, createEmptyProfile } from '@/shared/storage'
import { chat } from '../llm'
import { planAgentRound, planAgentShadow } from '../agentPlanner'

vi.mock('../llm', () => ({
  chat: vi.fn(),
  parseJsonLoose: (value: string) => JSON.parse(value),
}))

function model(): PageModel {
  const makeField = (id: string, label: string) => ({
    id,
    signals: { label, labelNear: [], placeholder: '', name: '', id: '', ariaLabel: '', title: '', sectionTitle: '基本信息' },
    control: {
      id: `control_${id}`, kind: 'text' as const,
      root: { cssPath: `#${id}`, index: 0, framePath: [], signature: id }, parts: [], options: [],
      required: false, disabled: false, readOnly: false, currentState: 'empty' as const, commitStrategy: 'native-input',
    },
  })
  return {
    version: 2, url: 'https://example.com/resume', title: 'test', capturedAt: 0, adapterId: 'generic', adapterMaturity: 'research',
    sections: [{
      id: 'basic', title: '基本信息', root: { cssPath: '#basic', index: 0, framePath: [], signature: 'basic' },
      semanticCandidates: ['basic'], entries: [], fields: [makeField('name', '姓名'), makeField('email', '邮箱')], actions: [],
    }], globalActions: [],
  }
}

function multiSectionModel(sizes: number[]): PageModel {
  const base = model()
  return {
    ...base,
    sections: sizes.map((size, sectionIndex) => ({
      ...base.sections[0],
      id: `section_${sectionIndex}`,
      title: `基本信息 ${sectionIndex + 1}`,
      root: { ...base.sections[0].root, cssPath: `#section-${sectionIndex}`, signature: `section-${sectionIndex}` },
      fields: Array.from({ length: size }, (_, fieldIndex) => ({
        ...base.sections[0].fields[0],
        id: `field_${sectionIndex}_${fieldIndex}`,
        control: {
          ...base.sections[0].fields[0].control,
          id: `control_${sectionIndex}_${fieldIndex}`,
          root: { ...base.sections[0].fields[0].control.root, cssPath: `#field-${sectionIndex}-${fieldIndex}`, signature: `field-${sectionIndex}-${fieldIndex}` },
        },
      })),
    })),
  }
}

describe('LLM-first shadow planner', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retries missing fields and returns complete terminal coverage', async () => {
    const profile = createEmptyProfile('测试档案')
    profile.basic.name = '示例用户'
    profile.basic.email = 'user@example.com'
    vi.mocked(chat)
      .mockImplementationOnce(async (_settings, messages) => {
        const payload = JSON.parse(messages[1].content)
        const nameFact = payload.facts.find((fact: { path: string }) => fact.path === 'basic.name')
        return JSON.stringify({ calls: [{
          callId: 'c1', tool: 'fill_text_from_fact', reason: '姓名',
          args: { fieldId: 'name', factIds: [nameFact.factId], transform: 'identity' },
        }] })
      })
      .mockImplementationOnce(async (_settings, messages) => {
        const payload = JSON.parse(messages[1].content)
        const emailFact = payload.facts.find((fact: { path: string }) => fact.path === 'basic.email')
        return JSON.stringify({ calls: [{
          callId: 'c2', tool: 'fill_text_from_fact', reason: '邮箱',
          args: { fieldId: 'email', factIds: [emailFact.factId], transform: 'identity' },
        }] })
      })
    const result = await planAgentShadow(model(), profile, { ...DEFAULT_SETTINGS, apiBaseUrl: 'https://example.com/v1', apiKey: 'test', model: 'test', privacyMode: 'labels-only' })
    expect(chat).toHaveBeenCalledTimes(2)
    expect(result.coveredFieldIds.sort()).toEqual(['email', 'name'])
    expect(result.missingFieldIds).toHaveLength(0)
    expect(result.trace.modelRounds).toBe(2)
  })

  it('rejects dangerous output and locally marks fields missing after two rounds', async () => {
    const profile = createEmptyProfile('测试档案')
    profile.basic.name = '示例用户'
    profile.basic.email = 'user@example.com'
    vi.mocked(chat).mockResolvedValue(JSON.stringify({ calls: [
      { callId: 'bad', tool: 'submit', reason: 'bad', args: {} },
    ] }))
    const result = await planAgentShadow(model(), profile, { ...DEFAULT_SETTINGS, apiBaseUrl: 'https://example.com/v1', apiKey: 'test', model: 'test', privacyMode: 'labels-only' })
    expect(result.rejected.length).toBeGreaterThan(0)
    expect(result.calls.every((call) => call.tool === 'mark_manual')).toBe(true)
    expect(result.coveredFieldIds.sort()).toEqual(['email', 'name'])
  })

  it('keeps inspection-only fields unresolved for an execution-driven repair round', async () => {
    const profile = createEmptyProfile('测试档案')
    profile.basic.name = '示例用户'
    profile.basic.email = 'user@example.com'
    vi.mocked(chat).mockImplementationOnce(async (_settings, messages) => {
      const payload = JSON.parse(messages[1].content)
      const emailFact = payload.facts.find((fact: { path: string }) => fact.path === 'basic.email')
      return JSON.stringify({ calls: [
        { callId: 'inspect', tool: 'inspect_control', reason: '先确认控件', args: { fieldId: 'name' } },
        { callId: 'email', tool: 'fill_text_from_fact', reason: '邮箱', args: { fieldId: 'email', factIds: [emailFact.factId], transform: 'identity' } },
      ] })
    })
    const result = await planAgentRound(model(), profile, { ...DEFAULT_SETTINGS, apiBaseUrl: 'https://example.com/v1', apiKey: 'test', model: 'test', privacyMode: 'labels-only' }, { round: 1 })
    expect(result.calls.map((call) => call.tool)).toEqual(['inspect_control', 'fill_text_from_fact'])
    expect(result.coveredFieldIds).toEqual(['email'])
    expect(result.missingFieldIds).toEqual(['name'])
  })

  it('plans large pages in small section-aware batches instead of one monolithic request', async () => {
    const profile = createEmptyProfile('测试档案')
    profile.basic.name = '示例用户'
    vi.mocked(chat).mockResolvedValue('{"calls":[]}')
    const result = await planAgentRound(multiSectionModel([9, 9, 7]), profile, {
      ...DEFAULT_SETTINGS, apiBaseUrl: 'https://example.com/v1', apiKey: 'test', model: 'test', privacyMode: 'labels-only',
    }, { round: 1 })
    expect(chat).toHaveBeenCalledTimes(3)
    const payloadSizes = vi.mocked(chat).mock.calls.map((call) => JSON.parse(call[1][1].content).fields.length)
    expect(payloadSizes).toEqual([9, 9, 7])
    expect(result.missingFieldIds).toHaveLength(25)
    expect(result.trace.modelRounds).toBe(3)
  })

  it('keeps successful batch plans when another batch fails', async () => {
    const profile = createEmptyProfile('测试档案')
    profile.basic.name = '示例用户'
    vi.mocked(chat)
      .mockRejectedValueOnce(new Error('slow batch'))
      .mockImplementationOnce(async (_settings, messages) => {
        const payload = JSON.parse(messages[1].content)
        return JSON.stringify({ calls: payload.fields.map((field: { fieldId: string }, index: number) => ({
          callId: `manual_${index}`, tool: 'mark_manual', reason: '安全结束', args: { fieldId: field.fieldId, reason: '测试人工' },
        })) })
      })
    const result = await planAgentRound(multiSectionModel([8, 8]), profile, {
      ...DEFAULT_SETTINGS, apiBaseUrl: 'https://example.com/v1', apiKey: 'test', model: 'test', privacyMode: 'labels-only',
    }, { round: 1 })
    expect(result.calls).toHaveLength(8)
    expect(result.rejected.some((item) => item.reason.includes('slow batch'))).toBe(true)
    expect(result.missingFieldIds).toHaveLength(8)
  })
})
