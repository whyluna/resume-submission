import { afterEach, describe, expect, it } from 'vitest'
import type { ControlPartRole, ElementRefV2, PageField, PageModel } from '@/shared/pageModel'
import { createEmptyProfile } from '@/shared/storage'
import { AgentToolGateway } from '../agent/toolGateway'

function ref(selector: string): ElementRefV2 {
  return { cssPath: selector, index: 0, framePath: [], signature: selector }
}

function field(id: string, label: string, kind: PageField['control']['kind'], selector: string, roles: Array<[ControlPartRole, string]> = []): PageField {
  return {
    id,
    signals: { label, labelNear: [], placeholder: '', name: '', id: '', ariaLabel: '', title: '', sectionTitle: '基本信息' },
    control: {
      id: `control_${id}`, kind, root: ref(selector),
      parts: roles.map(([role, partSelector]) => ({ role, ref: ref(partSelector) })),
      options: [], required: false, disabled: false, readOnly: false, currentState: 'empty', commitStrategy: 'test',
    },
  }
}

function model(fields: PageField[]): PageModel {
  return {
    version: 2, url: 'https://example.com/resume', title: 'agent gateway', capturedAt: 0,
    adapterId: 'generic', adapterMaturity: 'research', globalActions: [],
    sections: [{
      id: 'basic', title: '基本信息', root: ref('#basic'), semanticCandidates: ['basic'], entries: [], fields, actions: [],
    }],
  }
}

function factId(gateway: AgentToolGateway, path: string): string {
  const fact = gateway.getObservation().facts.find((candidate) => candidate.path === path)
  if (!fact) throw new Error(`missing fact ${path}`)
  return fact.factId
}

afterEach(() => { document.body.innerHTML = '' })

describe('agent tool gateway', () => {
  it('executes fact-bound text, select and single-date tools with readback', async () => {
    document.body.innerHTML = `<section id="basic">
      <input id="name">
      <select id="gender"><option value="">请选择</option><option value="male">男</option><option value="female">女</option></select>
      <input id="birth" type="month">
    </section>`
    const page = model([
      field('name', '姓名', 'text', '#name', [['input', '#name']]),
      field('gender', '性别', 'native-select', '#gender', [['option-source', '#gender']]),
      field('birth', '出生日期', 'date-single', '#birth', [['input', '#birth']]),
    ])
    const profile = createEmptyProfile('测试档案')
    profile.basic.name = '示例用户'
    profile.basic.gender = '男'
    profile.basic.birthDate = '2002-08 (24岁)'
    const gateway = new AgentToolGateway(page, profile, 'labels-only', document)

    const batch = await gateway.executeCalls([
      { callId: 'name', tool: 'fill_text_from_fact', reason: '姓名', args: { fieldId: 'name', factIds: [factId(gateway, 'basic.name')], transform: 'identity' } },
      { callId: 'gender', tool: 'select_option_from_fact', reason: '性别', args: { fieldId: 'gender', factId: factId(gateway, 'basic.gender'), match: 'synonym' } },
      { callId: 'birth', tool: 'fill_date_from_facts', reason: '出生日期', args: { fieldId: 'birth', startFactId: factId(gateway, 'basic.birthDate'), requestedShape: 'single' } },
    ])

    expect(batch.results.map((result) => result.status)).toEqual(['verified', 'verified', 'verified'])
    expect((document.querySelector('#name') as HTMLInputElement).value).toBe('示例用户')
    expect((document.querySelector('#gender') as HTMLSelectElement).value).toBe('male')
    expect((document.querySelector('#birth') as HTMLInputElement).value).toBe('2002-08')
  })

  it('splits one date range fact set across six physical date parts', async () => {
    const select = (id: string, values: string[]) => `<select id="${id}">${values.map((value) => `<option value="${value}">${value}</option>`).join('')}</select>`
    document.body.innerHTML = `<section id="basic"><div id="range">
      ${select('sy', ['2021', '2022'])}${select('sm', ['08', '09'])}${select('sd', ['01', '15'])}
      ${select('ey', ['2025', '2026'])}${select('em', ['05', '06'])}${select('ed', ['20', '30'])}
    </div></section>`
    const range = field('study-range', '就读时间', 'date-range-parts', '#range', [
      ['start-year', '#sy'], ['start-month', '#sm'], ['start-day', '#sd'],
      ['end-year', '#ey'], ['end-month', '#em'], ['end-day', '#ed'],
    ])
    const profile = createEmptyProfile('测试档案')
    profile.educations[0].school = '示例大学'
    profile.educations[0].startDate = '2022-09-15'
    profile.educations[0].endDate = '2026-06-30'
    const gateway = new AgentToolGateway(model([range]), profile, 'labels-only', document)
    const batch = await gateway.executeCalls([{
      callId: 'range', tool: 'fill_date_from_facts', reason: '教育起止时间',
      args: {
        fieldId: 'study-range', startFactId: factId(gateway, 'educations[0].startDate'),
        endFactId: factId(gateway, 'educations[0].endDate'), requestedShape: 'range',
      },
    }])

    expect(batch.results[0].status).toBe('verified')
    expect(['sy', 'sm', 'sd', 'ey', 'em', 'ed'].map((id) => (document.querySelector(`#${id}`) as HTMLSelectElement).value))
      .toEqual(['2022', '09', '15', '2026', '06', '30'])
  })

  it('rejects unknown and dangerous runtime actions before execution', async () => {
    document.body.innerHTML = '<section id="basic"><input id="name"></section>'
    const profile = createEmptyProfile('测试档案')
    profile.basic.name = '示例用户'
    const gateway = new AgentToolGateway(model([field('name', '姓名', 'text', '#name')]), profile, 'labels-only', document)
    const batch = await gateway.executeCalls([
      { callId: 'unsafe', tool: 'submit', reason: '不允许', args: {} },
      { callId: 'invented', tool: 'fill_text_from_fact', reason: '编造', args: { fieldId: 'name', factIds: ['unknown'], transform: 'identity' } },
    ])
    expect(batch.plan.calls).toHaveLength(0)
    expect(batch.plan.rejected).toHaveLength(2)
    expect((document.querySelector('#name') as HTMLInputElement).value).toBe('')
  })

  it('never allows a restricted identifier fact to drive a select control', async () => {
    document.body.innerHTML = '<section id="basic"><select id="id-type"><option value="">请选择</option><option>身份证</option></select></section>'
    const page = model([field('id-type', '证件号码', 'native-select', '#id-type', [['option-source', '#id-type']])])
    const profile = createEmptyProfile('测试档案')
    profile.basic.idNumber = '110101199901010019'
    const gateway = new AgentToolGateway(page, profile, 'labels-only', document)
    const batch = await gateway.executeCalls([{
      callId: 'bad-id-select', tool: 'select_option_from_fact', reason: '模型误把号码当类型',
      args: { fieldId: 'id-type', factId: factId(gateway, 'basic.idNumber'), match: 'normalized' },
    }])
    expect(batch.results[0]).toMatchObject({ status: 'failed', errorClass: 'safety' })
    expect((document.querySelector('#id-type') as HTMLSelectElement).value).toBe('')
  })
})
