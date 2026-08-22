import { describe, expect, it } from 'vitest'
import { normalizeDateValue, normalizeProfileDates } from '../dateValues'
import { createEmptyProfile } from '../storage'

describe('canonical profile dates', () => {
  it.each([
    ['2022年9月', '2022-09'],
    ['２０２２/９', '2022-09'],
    ['2025.6.7', '2025-06-07'],
    ['2024年', '2024'],
    ['2002-08 (24岁)', '2002-08'],
    ['2002-08（24岁）', '2002-08'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeDateValue(input)).toMatchObject({ value: expected, valid: true, ongoing: false })
  })

  it('preserves an invalid legacy value without claiming it is canonical', () => {
    expect(normalizeDateValue('2025-02-30')).toEqual({ value: '2025-02-30', valid: false, ongoing: false })
  })

  it('migrates embedded ranges and ongoing markers at the profile boundary', () => {
    const profile = createEmptyProfile('测试档案')
    profile.projects = [{
      enabled: true,
      name: '示例项目', role: '', startDate: '2022年9月 ~ 至今', endDate: '', endDateIsNow: false,
      url: '', description: '', contribution: '', achievements: '', techStack: [],
    }]
    normalizeProfileDates(profile)
    expect(profile.projects[0]).toMatchObject({ startDate: '2022-09', endDate: '', endDateIsNow: true })
  })
})
