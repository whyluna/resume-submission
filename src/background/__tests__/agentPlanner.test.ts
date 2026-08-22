import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageModel } from '@/shared/pageModel'
import { DEFAULT_SETTINGS, createEmptyProfile } from '@/shared/storage'
import { chat } from '../llm'
import { planAgentShadow } from '../agentPlanner'

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
})
