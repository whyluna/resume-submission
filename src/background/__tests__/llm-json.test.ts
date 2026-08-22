import { describe, expect, it } from 'vitest'
import { parseJsonLoose } from '../llm'

describe('loose model JSON parsing', () => {
  it('skips an invalid schema example and parses the later real calls object', () => {
    const parsed = parseJsonLoose<{ calls: Array<{ callId: string }> }>(
      'Return {"calls":[...]} with no prose. Actual output: {"calls":[{"callId":"c1"}]}',
    )
    expect(parsed.calls).toEqual([{ callId: 'c1' }])
  })

  it('accepts fenced JSON and trailing commas', () => {
    const parsed = parseJsonLoose<{ calls: unknown[] }>('说明文字\n```json\n{"calls": [],}\n```')
    expect(parsed).toEqual({ calls: [] })
  })
})
