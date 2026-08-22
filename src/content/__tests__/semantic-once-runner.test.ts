import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SemanticPlanItem } from '@/shared/semanticPlan'
import { createEmptyProfile } from '@/shared/storage'
import type { OneShotSemanticResponse } from '@/shared/types'
import { discoverPageModel } from '../discover/pageModel'
import { runSemanticOnce } from '../agent/runSemanticOnce'

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({
    0: {} as DOMRect, length: 1, item: () => null, [Symbol.iterator]: function* () { yield {} as DOMRect },
  } as DOMRectList)
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ display: 'block', visibility: 'visible', opacity: '1' } as CSSStyleDeclaration)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function response(plan: SemanticPlanItem[], sources: OneShotSemanticResponse['sources']): OneShotSemanticResponse {
  return {
    ok: true, plan, modelRequestCount: 1, modelDecisions: plan.length, ruleDecisions: 0,
    manualDecisions: plan.filter((item) => item.decision === 'manual').length,
    rejected: [], messages: [], latencyMs: 10, sources,
  }
}

describe('single semantic review runner', () => {
  it('uses rule candidates as LLM evidence, executes locally, then performs final readback', async () => {
    document.body.innerHTML = `<section><h2>个人信息</h2><div class="semantic-row">
      <span class="semantic-label">姓名</span><input placeholder="请输入姓名">
    </div></section>`
    const profile = createEmptyProfile('测试档案')
    profile.basic.name = '示例用户'
    const model = discoverPageModel(document, 'https://example.com/resume')
    let requests = 0
    const report = await runSemanticOnce(model, profile, 'labels-only', async (ir) => {
      requests++
      const target = ir.fields.find((field) => field.labels.includes('姓名'))
      const hint = target?.ruleHints.find((candidate) => candidate.path === 'basic.name')
      expect(target?.componentHtml).toContain('kind="text"')
      expect(hint).toBeDefined()
      return response([{
        fieldId: target!.fieldId, decision: 'keep-rule', profilePaths: ['basic.name'],
        transform: 'identity', confidence: 0.99, reason: '标准字段复审通过',
      }], { [target!.fieldId]: 'llm-review' })
    }, document)

    expect(requests).toBe(1)
    expect((document.querySelector('section input') as HTMLInputElement).value).toBe('示例用户')
    expect(report.execution).toMatchObject({ verified: 1, failed: 0 })
    expect(report.execution.results[0].message).toContain('最终重新扫描读回一致')
  })

  it('locally rejects an unsafe model decision and uses the field rule candidate', async () => {
    document.body.innerHTML = `<section><h2>个人信息</h2><div class="semantic-row">
      <span class="semantic-label">姓名</span><input>
    </div></section>`
    const profile = createEmptyProfile('测试档案')
    profile.basic.name = '示例用户'
    profile.basic.email = 'user@example.com'
    const model = discoverPageModel(document, 'https://example.com/resume')
    const report = await runSemanticOnce(model, profile, 'labels-only', async (ir) => {
      const target = ir.fields[0]
      return response([{
        fieldId: target.fieldId, decision: 'fill', profilePaths: ['invented.path'],
        transform: 'identity', confidence: 0.9, reason: '不安全路径',
      }], { [target.fieldId]: 'llm-review' })
    }, document)
    expect(report.sources[report.ir.fields[0].fieldId]).toBe('rule-candidate')
    expect((document.querySelector('section input') as HTMLInputElement).value).toBe('示例用户')
    expect(report.review.messages.join(' ')).toContain('内容侧再次拒绝')
  })

  it('pre-materializes all repeat entries and routes them before the one model request', async () => {
    const html = readFileSync(path.join(process.cwd(), 'e2e/fixtures/moka-real-structure.html'), 'utf8')
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    document.body.innerHTML = parsed.body.innerHTML
    document.querySelector('.resume-panel button')?.addEventListener('click', () => {
      const card = document.querySelector('.education-card')?.cloneNode(true)
      if (card) document.querySelector('.resume-panel')?.appendChild(card)
    })
    const profile = createEmptyProfile('测试档案')
    profile.educations[0].school = '第一所学校'
    profile.educations.push({ ...profile.educations[0], school: '第二所学校' })
    const model = discoverPageModel(document, 'https://app.mokahr.com/resume')
    const report = await runSemanticOnce(model, profile, 'labels-only', async (ir) => {
      const education = ir.sections.find((section) => section.semanticCandidates.includes('educations'))
      expect(education).toMatchObject({ currentEntryCount: 2, desiredEntryCount: 2 })
      expect(education?.entryRoutes.map((route) => route.factPrefix)).toEqual(['educations[0]', 'educations[1]'])
      const plan: SemanticPlanItem[] = ir.fields.map((field) => ({
        fieldId: field.fieldId, decision: 'manual', profilePaths: [], transform: 'identity', confidence: 1, reason: '测试不写入',
      }))
      return response(plan, Object.fromEntries(ir.fields.map((field) => [field.fieldId, 'llm-review'])))
    }, document)
    expect(report.prepared.added).toBe(1)
    expect(report.ir.sections.find((section) => section.semanticCandidates.includes('educations'))?.currentEntryCount).toBe(2)
  })
})
