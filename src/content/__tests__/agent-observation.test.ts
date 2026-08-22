import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProfile } from '@/shared/storage'
import { discoverPageModel } from '../discover/pageModel'
import { generateRuleCandidateIndex } from '../planner/ruleCandidates'
import { buildAgentObservation } from '../agent/observe'

beforeEach(() => {
  const html = readFileSync(path.join(process.cwd(), 'e2e/fixtures/moka-real-structure.html'), 'utf8')
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  document.body.innerHTML = parsed.body.innerHTML
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({ length: 1, item: () => null, [Symbol.iterator]: function* () {} } as DOMRectList)
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ display: 'block', visibility: 'visible', opacity: '1' } as CSSStyleDeclaration)
})

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('agent observation', () => {
  it('publishes semantic IDs and capabilities without restricted fact values or selectors', () => {
    const model = discoverPageModel(document, 'https://app.mokahr.com/campus-recruitment/example#/candidateHome/resume?token=secret')
    const profile = createEmptyProfile('测试档案')
    profile.basic.idNumber = '110101199901010019'
    profile.educations[0].school = '示例大学'
    const candidates = generateRuleCandidateIndex(model, profile)
    const observation = buildAgentObservation(model, profile, 'with-values', candidates)
    const serialized = JSON.stringify(observation)
    expect(observation.fields.some((field) => field.capabilities.includes('fill-date'))).toBe(true)
    expect(observation.facts.find((fact) => fact.path === 'basic.idNumber')).toMatchObject({ sensitivity: 'restricted', value: undefined })
    expect(observation.facts.find((fact) => fact.path === 'basic.idType')).toMatchObject({ valueType: 'enum' })
    expect(serialized).not.toContain(profile.basic.idNumber)
    expect(serialized).not.toContain('cssPath')
    expect(serialized).not.toContain('token=secret')
  })
})
