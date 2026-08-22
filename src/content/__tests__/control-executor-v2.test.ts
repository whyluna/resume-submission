import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ControlGroup, ControlPartRole, ElementRefV2, PageField } from '@/shared/pageModel'
import { projectDateRange } from '../planner/projection'
import { executeControl } from '../executorV2/controls'
import { executeSemanticPlan } from '../executorV2/executePlan'
import { createEmptyProfile } from '@/shared/storage'
import type { PageModel } from '@/shared/pageModel'

function ref(selector: string): ElementRefV2 {
  return { cssPath: selector, index: 0, framePath: [], signature: selector }
}

function field(id: string, kind: ControlGroup['kind'], root: string, parts: Array<[ControlPartRole, string]>): PageField {
  return {
    id,
    signals: { label: id, labelNear: [], placeholder: '', name: '', id: '', ariaLabel: '', title: '', sectionTitle: '测试' },
    control: {
      id: `control_${id}`,
      kind,
      root: ref(root),
      parts: parts.map(([role, selector]) => ({ role, ref: ref(selector) })),
      options: [], required: false, disabled: false, readOnly: false, currentState: 'empty', commitStrategy: 'test',
    },
  }
}

beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => { document.body.innerHTML = '' })

describe('V2 verified control executor', () => {
  it('counts a portal combobox only after an option click changes authoritative selected state', async () => {
    document.body.innerHTML = `
      <button id="save">保存</button>
      <div id="combo" role="combobox" aria-controls="school-options">
        <span class="selected-label"></span><input id="search">
      </div>
      <div id="school-options" role="listbox" style="display:none">
        <div role="option" id="school-option">示例大学</div>
      </div>`
    let saveClicks = 0
    document.querySelector('#save')?.addEventListener('click', () => saveClicks++)
    document.querySelector('#combo')?.addEventListener('click', () => {
      ;(document.querySelector('#school-options') as HTMLElement).style.display = 'block'
    })
    document.querySelector('#school-option')?.addEventListener('click', () => {
      ;(document.querySelector('.selected-label') as HTMLElement).textContent = '示例大学'
      ;(document.querySelector('#school-options') as HTMLElement).style.display = 'none'
    })

    const combo = field('school', 'combobox', '#combo', [['trigger', '#combo'], ['input', '#search']])
    const result = await executeControl({ field: combo, value: { kind: 'scalar', value: '示例大学' } })
    expect(result).toMatchObject({ fieldId: 'school', state: 'verified', written: true, committed: true, verified: true })
    expect(saveClicks).toBe(0)
  })

  it('does not treat typed search text as a selected option', async () => {
    document.body.innerHTML = `
      <div id="combo" role="combobox" aria-controls="options"><input id="search"></div>
      <div id="options" role="listbox"><div role="option">另一所大学</div></div>`
    const combo = field('school', 'combobox', '#combo', [['trigger', '#combo'], ['input', '#search']])
    const result = await executeControl({ field: combo, value: { kind: 'scalar', value: '目标大学' } })
    expect((document.querySelector('#search') as HTMLInputElement).value).toBe('目标大学')
    expect(result).toMatchObject({ state: 'failed', written: true, verified: false, failureClass: 'validation' })
  })

  it('writes and reads back split year/month controls plus the current toggle', async () => {
    document.body.innerHTML = `
      <div id="range">
        <input id="sy" readonly><input id="sm" readonly>
        <input id="ey" readonly value="2024"><input id="em" readonly value="06">
        <input id="current" type="checkbox">
      </div>`
    const range = field('education-range', 'date-range-parts', '#range', [
      ['start-year', '#sy'], ['start-month', '#sm'], ['end-year', '#ey'], ['end-month', '#em'], ['current-toggle', '#current'],
    ])
    const result = await executeControl({
      field: range,
      value: projectDateRange({ startDate: '2022-09', endDate: '', endDateIsNow: true }),
    })
    expect(result).toMatchObject({ state: 'verified', verified: true })
    expect((document.querySelector('#sy') as HTMLInputElement).value).toBe('2022')
    expect((document.querySelector('#sm') as HTMLInputElement).value).toBe('09')
    expect((document.querySelector('#ey') as HTMLInputElement).value).toBe('')
    expect((document.querySelector('#em') as HTMLInputElement).value).toBe('')
    expect((document.querySelector('#current') as HTMLInputElement).checked).toBe(true)
  })

  it('marks maxlength truncation for manual review instead of verified', async () => {
    document.body.innerHTML = '<textarea id="summary" maxlength="5"></textarea>'
    const text = field('summary', 'textarea', '#summary', [['input', '#summary']])
    const result = await executeControl({ field: text, value: { kind: 'scalar', value: '123456' } })
    expect(result).toMatchObject({ state: 'manual', written: true, committed: true, verified: false, failureClass: 'validation' })
    expect((document.querySelector('#summary') as HTMLTextAreaElement).value).toBe('12345')
  })

  it('projects an __range plan from structured profile dates before execution', async () => {
    document.body.innerHTML = `
      <section id="education"><div id="range">
        <input id="sy"><input id="sm"><input id="ey"><input id="em"><input id="current" type="checkbox">
      </div></section>`
    const range = field('education-range', 'date-range-parts', '#range', [
      ['start-year', '#sy'], ['start-month', '#sm'], ['end-year', '#ey'], ['end-month', '#em'], ['current-toggle', '#current'],
    ])
    const model: PageModel = {
      version: 2, url: 'https://example.com', title: 'test', capturedAt: 0, adapterId: 'generic', adapterMaturity: 'research',
      sections: [{
        id: 'education', title: '教育经历', root: ref('#education'), semanticCandidates: ['educations'],
        entries: [{ id: 'entry', index: 0, root: ref('#education'), kindCandidates: ['educations'], fields: [range] }],
        fields: [], actions: [],
      }], globalActions: [],
    }
    const profile = createEmptyProfile('测试档案')
    profile.educations[0].startDate = '2022-09'
    profile.educations[0].endDate = ''
    profile.educations[0].endDateIsNow = true
    const report = await executeSemanticPlan(model, profile, [{
      fieldId: range.id, decision: 'keep-rule', profilePaths: ['educations[0].__range'],
      transform: 'split-date-parts', confidence: 0.9, reason: '日期区间',
    }])
    expect(report).toMatchObject({ total: 1, verified: 1, manual: 0, failed: 0 })
    expect((document.querySelector('#current') as HTMLInputElement).checked).toBe(true)
  })
})
