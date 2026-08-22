import { describe, expect, it } from 'vitest'
import type { AgentFactRef, AgentToolCall } from '../agent'
import type { FormFieldIR, FormPageIR } from '../formIr'
import { validateOneShotPlan } from '../oneShotValidation'

function fact(factId: string, path: string, valueType: AgentFactRef['valueType'], sensitivity: AgentFactRef['sensitivity'] = 'normal'): AgentFactRef {
  return { factId, path, label: path, valueType, sensitivity, hasValue: true }
}

function field(fieldId: string, kind: FormFieldIR['controlKind'] = 'text'): FormFieldIR {
  const capabilities: FormFieldIR['capabilities'] = kind === 'text' ? ['write-text']
    : kind === 'date-range-parts' ? ['fill-date'] : ['select-option']
  const allowedTools: FormFieldIR['allowedTools'] = kind === 'text'
    ? ['fill_text_from_fact', 'mark_manual', 'mark_skip']
    : kind === 'date-range-parts'
      ? ['fill_date_from_facts', 'mark_manual', 'mark_skip']
      : ['select_option_from_fact', 'mark_manual', 'mark_skip']
  return {
    fieldId, sectionId: 'section', sectionTitle: '测试', labels: [fieldId], controlGroupId: `control_${fieldId}`,
    controlKind: kind, capabilities, parts: [], existingState: 'empty', required: false, ruleHints: [],
    componentHtml: `<field id="${fieldId}"/>`, allowedTools,
    constraints: {
      dateShape: kind === 'date-range-parts' ? 'range-parts' : 'none',
      mustCommitOption: capabilities.includes('select-option'), commitStrategy: 'test',
      successEvidence: capabilities.includes('select-option') ? 'selected-state' : 'value',
    },
  }
}

function ir(fields: FormFieldIR[], facts: AgentFactRef[]): FormPageIR {
  return {
    version: 1, pageId: 'page', adapterId: 'generic', adapterMaturity: 'research', urlPattern: 'https://example.com/resume',
    sections: [{
      sectionId: 'section', title: '测试', semanticCandidates: ['basic'], currentEntryCount: 0,
      desiredEntryCount: 0, entryRoutes: [], fieldIds: fields.map((item) => item.fieldId),
    }],
    fields, facts, forbiddenActions: ['save', 'submit'],
  }
}

describe('one-shot atomic plan validation', () => {
  it('accepts exactly one semantically compatible action for every field', () => {
    const name = field('name')
    const gender = field('gender', 'native-select')
    const page = ir([name, gender], [fact('f_name', 'basic.name', 'text'), fact('f_gender', 'basic.gender', 'enum')])
    const result = validateOneShotPlan([
      { callId: 'a', tool: 'fill_text_from_fact', reason: '姓名', args: { fieldId: 'name', factIds: ['f_name'], transform: 'identity' } },
      { callId: 'b', tool: 'select_option_from_fact', reason: '性别', args: { fieldId: 'gender', factId: 'f_gender', match: 'synonym' } },
    ], page)
    expect(result.complete).toBe(true)
    expect(result.calls).toHaveLength(2)
  })

  it('rejects the whole plan when one field is missing or duplicated', () => {
    const page = ir([field('name'), field('email')], [fact('f_name', 'basic.name', 'text')])
    const result = validateOneShotPlan([
      { callId: 'a', tool: 'fill_text_from_fact', reason: '姓名', args: { fieldId: 'name', factIds: ['f_name'], transform: 'identity' } },
      { callId: 'b', tool: 'fill_text_from_fact', reason: '重复', args: { fieldId: 'name', factIds: ['f_name'], transform: 'identity' } },
    ], page)
    expect(result.complete).toBe(false)
    expect(result.missingFieldIds.sort()).toEqual(['email', 'name'])
    expect(result.rejected.some((reason) => reason.includes('终态动作'))).toBe(true)
  })

  it('rejects an ID number routed into the document-type select', () => {
    const idType = field('id-type', 'custom-select')
    idType.compound = { groupId: 'id-row', index: 0, size: 2, siblingFieldIds: ['id-number'] }
    idType.ruleHints = [{ factId: 'f_type', path: 'basic.idType', confidence: 0.99, transform: 'enum-normalize', reason: '复合行类型' }]
    const page = ir([idType], [
      fact('f_type', 'basic.idType', 'enum'),
      fact('f_number', 'basic.idNumber', 'text', 'restricted'),
    ])
    const result = validateOneShotPlan([{
      callId: 'bad', tool: 'select_option_from_fact', reason: '错误映射',
      args: { fieldId: 'id-type', factId: 'f_number', match: 'normalized' },
    }], page)
    expect(result.complete).toBe(false)
    expect(result.rejected.join(' ')).toMatch(/受限|结构语义/)
  })

  it('rejects facts from another repeated entry and validates separate date facts', () => {
    const date = field('project-date', 'date-range-parts')
    date.entryId = 'entry-1'
    date.entryRoute = {
      pageSectionId: 'section', pageEntryId: 'entry-1', pageEntryIndex: 1,
      profileSection: 'projects', profileIndex: 1, factPrefix: 'projects[1]',
    }
    const page = ir([date], [
      fact('p0s', 'projects[0].startDate', 'date'), fact('p0e', 'projects[0].endDate', 'date'),
      fact('p1s', 'projects[1].startDate', 'date'), fact('p1e', 'projects[1].endDate', 'date'),
    ])
    const wrong = validateOneShotPlan([{
      callId: 'wrong', tool: 'fill_date_from_facts', reason: '错误条目',
      args: { fieldId: 'project-date', startFactId: 'p0s', endFactId: 'p0e', requestedShape: 'range' },
    }], page)
    const right = validateOneShotPlan([{
      callId: 'right', tool: 'fill_date_from_facts', reason: '正确条目',
      args: { fieldId: 'project-date', startFactId: 'p1s', endFactId: 'p1e', requestedShape: 'range' },
    }], page)
    expect(wrong.complete).toBe(false)
    expect(wrong.rejected.join(' ')).toContain('其他重复条目')
    expect(right.complete).toBe(true)
  })
})
