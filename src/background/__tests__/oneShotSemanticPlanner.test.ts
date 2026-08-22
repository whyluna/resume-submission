import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentFactRef } from '@/shared/agent'
import type { FormFieldIR, FormPageIR } from '@/shared/formIr'
import { DEFAULT_SETTINGS } from '@/shared/storage'
import { chat } from '../llm'
import { reviewPageOneShot } from '../oneShotSemanticPlanner'

vi.mock('../llm', () => ({
  chat: vi.fn(),
  parseJsonLoose: (value: string) => JSON.parse(value),
}))

function fact(path: string): AgentFactRef {
  return { factId: `fact_${path}`, path, label: path, valueType: 'text', sensitivity: 'normal', hasValue: true }
}

function field(fieldId: string, path?: string): FormFieldIR {
  return {
    fieldId, sectionId: 'basic', sectionTitle: '基本信息', labels: [fieldId], controlGroupId: `c_${fieldId}`,
    controlKind: 'text', capabilities: ['write-text'], parts: [], existingState: 'empty', required: false,
    ruleHints: path ? [{ factId: `fact_${path}`, path, confidence: 0.9, transform: 'identity', reason: '确定性候选' }] : [],
    componentHtml: `<field id="${fieldId}"/>`, allowedTransforms: ['identity', 'aggregate-text'],
    constraints: { dateShape: 'none', mustCommitOption: false, commitStrategy: 'native', successEvidence: 'value' },
  }
}

function page(): FormPageIR {
  const fields = [field('name', 'basic.name'), field('growth-hometown')]
  return {
    version: 1, pageId: 'page', adapterId: 'generic', adapterMaturity: 'research', urlPattern: 'https://example.com/resume',
    sections: [{ sectionId: 'basic', title: '基本信息', semanticCandidates: ['basic'], currentEntryCount: 0, desiredEntryCount: 0, entryRoutes: [], fieldIds: fields.map((item) => item.fieldId) }],
    fields,
    facts: [fact('basic.name'), fact('basic.hometown')], forbiddenActions: ['save', 'submit'],
  }
}

const settings = { ...DEFAULT_SETTINGS, apiBaseUrl: 'https://example.com/v1', apiKey: 'key', model: 'model', privacyMode: 'labels-only' as const }

describe('one-shot full-page semantic reviewer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reviews rule and long-tail fields in one model request without emitting browser tools', async () => {
    vi.mocked(chat).mockResolvedValue(JSON.stringify({ plan: [
      { fieldId: 'name', decision: 'keep-rule', profilePaths: ['basic.name'], transform: 'identity', confidence: 0.99, reason: '标准姓名' },
      { fieldId: 'growth-hometown', decision: 'fill', profilePaths: ['basic.hometown'], transform: 'identity', confidence: 0.85, reason: '成长故乡' },
    ] }))
    const result = await reviewPageOneShot(page(), settings)
    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.plan).toHaveLength(2)
    expect(result.modelDecisions).toBe(2)
    expect(result.ruleDecisions).toBe(0)
    const prompt = vi.mocked(chat).mock.calls[0][1][0].content
    expect(prompt).toContain('不得输出工具调用')
  })

  it('keeps valid LLM decisions and fills only missing decisions from local candidates/safety', async () => {
    vi.mocked(chat).mockResolvedValue(JSON.stringify({ plan: [
      { fieldId: 'name', decision: 'keep-rule', profilePaths: ['basic.name'], transform: 'identity', confidence: 0.99, reason: '标准姓名' },
    ] }))
    const result = await reviewPageOneShot(page(), settings)
    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.plan).toHaveLength(2)
    expect(result.sources.name).toBe('llm-review')
    expect(result.sources['growth-hometown']).toBe('local-safety')
    expect(result.plan.find((item) => item.fieldId === 'growth-hometown')?.decision).toBe('manual')
  })

  it('uses the rule candidate when the single model request fails', async () => {
    vi.mocked(chat).mockRejectedValue(new Error('timeout'))
    const result = await reviewPageOneShot(page(), settings)
    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.sources.name).toBe('rule-candidate')
    expect(result.plan.find((item) => item.fieldId === 'name')?.profilePaths).toEqual(['basic.name'])
    expect(result.messages.join(' ')).toContain('timeout')
  })
})
