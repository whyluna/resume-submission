import { describe, expect, it } from 'vitest'
import { AGENT_TOOL_NAMES, type AgentFieldObservation } from '../agent'
import { validateAgentPlan } from '../agentValidation'

function field(fieldId: string, state: AgentFieldObservation['existingState'] = 'empty'): AgentFieldObservation {
  return {
    fieldId, sectionId: 'basic', sectionTitle: '基本信息', labels: ['字段'], controlGroupId: `control_${fieldId}`,
    controlKind: 'text', capabilities: ['write-text'], parts: [], existingState: state, required: false, ruleHints: [],
  }
}

describe('agent tool safety protocol', () => {
  it('does not expose generic browser, script, save, next or submit tools', () => {
    expect(AGENT_TOOL_NAMES).not.toContain('click')
    expect(AGENT_TOOL_NAMES).not.toContain('type')
    expect(AGENT_TOOL_NAMES).not.toContain('run_js')
    expect(AGENT_TOOL_NAMES).not.toContain('save')
    expect(AGENT_TOOL_NAMES).not.toContain('next')
    expect(AGENT_TOOL_NAMES).not.toContain('submit')
  })

  it('requires a terminal action or explicit manual/skip decision for every eligible field', () => {
    const validated = validateAgentPlan([{
      callId: 'c1', tool: 'fill_text_from_fact', reason: '姓名映射',
      args: { fieldId: 'name', factIds: ['fact_name'], transform: 'identity' },
    }], [field('name'), field('email')], new Set(['fact_name']))
    expect(validated.coveredFieldIds).toEqual(['name'])
    expect(validated.missingFieldIds).toEqual(['email'])
  })

  it('rejects invented facts, unknown fields, dangerous tool names and non-empty overwrites', () => {
    const calls = [
      { callId: 'c1', tool: 'fill_text_from_fact', reason: 'bad fact', args: { fieldId: 'name', factIds: ['invented'], transform: 'identity' } },
      { callId: 'c2', tool: 'submit', reason: 'danger', args: {} },
      { callId: 'c3', tool: 'fill_text_from_fact', reason: 'overwrite', args: { fieldId: 'existing', factIds: ['fact_name'], transform: 'identity' } },
      { callId: 'c4', tool: 'mark_manual', reason: 'manual', args: { fieldId: 'existing', reason: '已有值' } },
    ]
    const validated = validateAgentPlan(calls, [field('name'), field('existing', 'non-empty')], new Set(['fact_name']))
    expect(validated.calls).toHaveLength(1)
    expect(validated.calls[0].tool).toBe('mark_manual')
    expect(validated.rejected).toHaveLength(3)
  })

  it('rejects malformed arguments, unknown sections and incompatible control tools', () => {
    const calls = [
      { callId: 'c1', tool: 'fill_text_from_fact', reason: 'missing facts', args: { fieldId: 'name', factIds: [], transform: 'identity' } },
      { callId: 'c2', tool: 'fill_date_from_facts', reason: 'wrong shape', args: { fieldId: 'name', startFactId: 'fact_name', requestedShape: 'single' } },
      { callId: 'c3', tool: 'inspect_section', reason: 'unknown', args: { sectionId: 'missing' } },
      { callId: 'c4', tool: 'mark_skip', reason: 'unsupported', args: { fieldId: 'name', reason: '' } },
    ]
    const validated = validateAgentPlan(calls, [field('name')], new Set(['fact_name']))
    expect(validated.calls).toHaveLength(0)
    expect(validated.rejected).toHaveLength(4)
    expect(validated.missingFieldIds).toEqual(['name'])
  })
})
