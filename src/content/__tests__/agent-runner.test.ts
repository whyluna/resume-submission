import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRoundResponse } from '@/shared/types'
import type { PageModel } from '@/shared/pageModel'
import { createEmptyProfile } from '@/shared/storage'
import { hashSig } from '@/shared/util'
import { discoverPageModel } from '../discover/pageModel'
import { runAgent, type AgentRoundRequester } from '../agent/runAgent'

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('bounded LLM agent runner', () => {
  it('feeds inspection/readback into a second round and verifies both fields', async () => {
    document.body.innerHTML = `<section id="basic"><h2>个人信息</h2>
      <div><label for="name">姓名</label><input id="name"></div>
      <div><label for="email">邮箱</label><input id="email"></div>
    </section>`
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({ length: 1, item: () => null, [Symbol.iterator]: function* () {} } as DOMRectList)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ display: 'block', visibility: 'visible', opacity: '1' } as CSSStyleDeclaration)
    vi.stubGlobal('CSS', { escape: (value: string) => value })
    const page = discoverPageModel(document, 'https://example.com/resume')
    const profile = createEmptyProfile('测试档案')
    profile.basic.name = '示例用户'
    profile.basic.email = 'user@example.com'
    const requested: Array<{ round: number; previousCount: number }> = []
    const planner: AgentRoundRequester = vi.fn(async ({ model, round, previousResults }: {
      model: PageModel; round: number; targetFieldIds: string[]; previousResults: import('@/shared/agent').AgentToolResult[]; previousIssues: string[]
    }) => {
      requested.push({ round, previousCount: previousResults.length })
      const fields = model.sections.flatMap((section) => section.fields)
      const name = fields.find((field) => field.signals.label === '姓名')!
      const email = fields.find((field) => field.signals.label === '邮箱')!
      const calls = round === 1 ? [
        { callId: 'inspect-name', tool: 'inspect_control', reason: '确认姓名控件', args: { fieldId: name.id } },
        { callId: 'fill-email', tool: 'fill_text_from_fact', reason: '填写邮箱', args: { fieldId: email.id, factIds: [`fact_${hashSig('basic.email')}`], transform: 'identity' } },
      ] : [
        { callId: 'fill-name', tool: 'fill_text_from_fact', reason: '填写姓名', args: { fieldId: name.id, factIds: [`fact_${hashSig('basic.name')}`], transform: 'identity' } },
      ]
      return {
        ok: true, calls, coveredFieldIds: round === 1 ? [email.id] : [name.id],
        missingFieldIds: round === 1 ? [name.id] : [], rejected: [], observationFieldCount: fields.length,
      } as AgentRoundResponse
    })
    const report = await runAgent(page, profile, 'labels-only', planner, document)
    expect(report.rounds).toBe(2)
    expect(requested).toEqual([{ round: 1, previousCount: 0 }, { round: 2, previousCount: 2 }])
    expect(Array.from(report.finalByField.values()).map((result) => result.status)).toEqual(['verified', 'verified'])
    expect((document.querySelector('#name') as HTMLInputElement).value).toBe('示例用户')
    expect((document.querySelector('#email') as HTMLInputElement).value).toBe('user@example.com')
  })
})
