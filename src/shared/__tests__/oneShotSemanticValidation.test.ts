import { describe, expect, it } from 'vitest'
import type { AgentFactRef } from '../agent'
import type { FormFieldIR, FormPageIR } from '../formIr'
import { validateOneShotSemanticPlan } from '../oneShotSemanticValidation'

function fact(path: string, valueType: AgentFactRef['valueType'], sensitivity: AgentFactRef['sensitivity'] = 'normal'): AgentFactRef {
  return { factId: `fact_${path}`, path, label: path, valueType, sensitivity, hasValue: true }
}

function field(fieldId: string, kind: FormFieldIR['controlKind'] = 'text'): FormFieldIR {
  const date = kind === 'date-range-parts'
  const select = kind === 'custom-select'
  return {
    fieldId, sectionId: 'section', sectionTitle: '测试', labels: [fieldId], controlGroupId: `control_${fieldId}`,
    controlKind: kind, capabilities: date ? ['fill-date'] : select ? ['select-option'] : ['write-text'], parts: [],
    existingState: 'empty', required: false, ruleHints: [], componentHtml: `<field id="${fieldId}"/>`,
    allowedTransforms: date ? ['split-date-parts'] : select ? ['enum-normalize', 'identity'] : ['identity', 'aggregate-text'],
    constraints: {
      dateShape: date ? 'range-parts' : 'none', mustCommitOption: select,
      commitStrategy: 'test', successEvidence: select ? 'selected-state' : 'value',
    },
  }
}

function ir(fields: FormFieldIR[], facts: AgentFactRef[]): FormPageIR {
  return {
    version: 1, pageId: 'page', adapterId: 'generic', adapterMaturity: 'research', urlPattern: 'https://example.com/resume',
    sections: [{ sectionId: 'section', title: '测试', semanticCandidates: ['basic'], currentEntryCount: 0, desiredEntryCount: 0, entryRoutes: [], fieldIds: fields.map((item) => item.fieldId) }],
    fields, facts, forbiddenActions: ['save', 'submit'],
  }
}

describe('one-shot semantic review validation', () => {
  it('accepts semantic decisions only and requires full field coverage to be reported', () => {
    const page = ir([field('name'), field('custom')], [fact('basic.name', 'text'), fact('extras[0].value', 'text')])
    const result = validateOneShotSemanticPlan([{
      fieldId: 'name', decision: 'fill', profilePaths: ['basic.name'], transform: 'identity', confidence: 0.9, reason: '姓名',
    }], page)
    expect(result.accepted).toHaveLength(1)
    expect(result.missingFieldIds).toEqual(['custom'])
  })

  it('rejects an ID number mapped into document type even when the model chooses a valid transform', () => {
    const idType = field('id-type', 'custom-select')
    idType.compound = { groupId: 'id-row', index: 0, size: 2, siblingFieldIds: ['id-number'] }
    idType.ruleHints = [{ factId: 'fact_basic.idType', path: 'basic.idType', confidence: 0.99, transform: 'enum-normalize', reason: '类型控件' }]
    const page = ir([idType], [fact('basic.idType', 'enum'), fact('basic.idNumber', 'text', 'restricted')])
    const result = validateOneShotSemanticPlan([{
      fieldId: 'id-type', decision: 'replace-rule', profilePaths: ['basic.idNumber'], transform: 'enum-normalize', confidence: 0.9, reason: '错误',
    }], page)
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected.join(' ')).toMatch(/结构语义|固定选项|受限/)
  })

  it('enforces repeated-entry routing and exact date transform shape', () => {
    const date = field('project-date', 'date-range-parts')
    date.entryId = 'entry-1'
    date.entryRoute = {
      pageSectionId: 'section', pageEntryId: 'entry-1', pageEntryIndex: 1,
      profileSection: 'projects', profileIndex: 1, factPrefix: 'projects[1]',
    }
    const page = ir([date], [
      fact('projects[0].startDate', 'date'), fact('projects[0].endDate', 'date'),
      fact('projects[1].startDate', 'date'), fact('projects[1].endDate', 'date'),
    ])
    const wrongEntry = validateOneShotSemanticPlan([{
      fieldId: 'project-date', decision: 'fill', profilePaths: ['projects[0].startDate', 'projects[0].endDate'],
      transform: 'split-date-parts', confidence: 0.9, reason: '错误条目',
    }], page)
    const wrongTransform = validateOneShotSemanticPlan([{
      fieldId: 'project-date', decision: 'fill', profilePaths: ['projects[1].startDate', 'projects[1].endDate'],
      transform: 'date-range', confidence: 0.9, reason: '错误转换',
    }], page)
    const right = validateOneShotSemanticPlan([{
      fieldId: 'project-date', decision: 'fill', profilePaths: ['projects[1].startDate', 'projects[1].endDate'],
      transform: 'split-date-parts', confidence: 0.9, reason: '正确',
    }], page)
    expect(wrongEntry.accepted).toHaveLength(0)
    expect(wrongTransform.accepted).toHaveLength(0)
    expect(right.accepted).toHaveLength(1)
  })
})
