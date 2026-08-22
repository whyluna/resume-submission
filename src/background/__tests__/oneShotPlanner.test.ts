import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentFactRef } from '@/shared/agent'
import type { FormFieldIR, FormPageIR } from '@/shared/formIr'
import { DEFAULT_SETTINGS } from '@/shared/storage'
import { chat } from '../llm'
import { buildRuleFallbackPlan, planOneShot } from '../oneShotPlanner'

vi.mock('../llm', () => ({
  chat: vi.fn(),
  parseJsonLoose: (value: string) => JSON.parse(value),
}))

function fact(factId: string, path: string, valueType: AgentFactRef['valueType']): AgentFactRef {
  return { factId, path, label: path, valueType, sensitivity: 'normal', hasValue: true }
}

function field(fieldId: string, path: string): FormFieldIR {
  return {
    fieldId, sectionId: 'basic', sectionTitle: '基本信息', labels: [fieldId], controlGroupId: `c_${fieldId}`,
    controlKind: 'text', capabilities: ['write-text'], parts: [], existingState: 'empty', required: false,
    ruleHints: [{ factId: `f_${fieldId}`, path, confidence: 0.9, transform: 'identity', reason: '规则候选' }],
    componentHtml: `<field id="${fieldId}"/>`, allowedTools: ['fill_text_from_fact', 'mark_manual', 'mark_skip'],
    constraints: { dateShape: 'none', mustCommitOption: false, commitStrategy: 'native', successEvidence: 'value' },
  }
}

function page(): FormPageIR {
  const fields = [field('name', 'basic.name'), field('email', 'basic.email')]
  return {
    version: 1, pageId: 'page', adapterId: 'generic', adapterMaturity: 'research', urlPattern: 'https://example.com/resume',
    sections: [{ sectionId: 'basic', title: '基本信息', semanticCandidates: ['basic'], currentEntryCount: 0, desiredEntryCount: 0, entryRoutes: [], fieldIds: ['name', 'email'] }],
    fields,
    facts: [fact('f_name', 'basic.name', 'text'), fact('f_email', 'basic.email', 'text')],
    forbiddenActions: ['save', 'submit'],
  }
}

describe('one-shot planner', () => {
  beforeEach(() => vi.clearAllMocks())

  it('makes one model request and accepts a complete plan', async () => {
    vi.mocked(chat).mockResolvedValue(JSON.stringify({ calls: [
      { callId: 'a', tool: 'fill_text_from_fact', reason: '姓名', args: { fieldId: 'name', factIds: ['f_name'], transform: 'identity' } },
      { callId: 'b', tool: 'fill_text_from_fact', reason: '邮箱', args: { fieldId: 'email', factIds: ['f_email'], transform: 'identity' } },
    ] }))
    const result = await planOneShot(page(), { ...DEFAULT_SETTINGS, apiBaseUrl: 'https://example.com/v1', apiKey: 'key', model: 'model', privacyMode: 'labels-only' })
    expect(chat).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: true, mode: 'llm', modelRequestCount: 1, complete: true })
    expect(result.calls).toHaveLength(2)
  })

  it('discards an incomplete model plan and uses one complete rule fallback plan', async () => {
    vi.mocked(chat).mockResolvedValue(JSON.stringify({ calls: [
      { callId: 'a', tool: 'fill_text_from_fact', reason: '姓名', args: { fieldId: 'name', factIds: ['f_name'], transform: 'identity' } },
    ] }))
    const result = await planOneShot(page(), { ...DEFAULT_SETTINGS, apiBaseUrl: 'https://example.com/v1', apiKey: 'key', model: 'model', privacyMode: 'labels-only' })
    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.mode).toBe('rule-fallback')
    expect(result.calls).toHaveLength(2)
    expect(result.calls.every((call) => call.callId.startsWith('fallback_'))).toBe(true)
  })

  it('builds exactly one terminal fallback action per field', () => {
    const calls = buildRuleFallbackPlan(page())
    expect(calls).toHaveLength(2)
    expect(new Set(calls.map((call) => 'fieldId' in call.args && call.args.fieldId)).size).toBe(2)
  })
})
