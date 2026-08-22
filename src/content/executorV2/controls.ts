import type { ControlGroup, ControlPart, ControlPartRole, PageField } from '@/shared/pageModel'
import type { ProjectedValue } from '@/shared/semanticPlan'
import type { ControlExecutionRequest, ControlExecutionResult } from './types'
import { isSynonym, norm } from '@/shared/util'
import { normalizeDateValue } from '@/shared/dateValues'
import { commitBlur, resolveElement, selectedText, setNativeValue, valueMatches, visible, waitFor } from './dom'

function result(fieldId: string, patch: Partial<ControlExecutionResult>): ControlExecutionResult {
  return {
    fieldId,
    state: 'failed',
    mapped: true,
    written: false,
    committed: false,
    verified: false,
    message: '',
    ...patch,
  }
}

function scalarValue(request: ControlExecutionRequest): string | null {
  return request.value.kind === 'scalar' ? request.value.value : null
}

function dateValueForElement(value: string, element: Element): { ok: boolean; value: string; reason?: string } {
  const canonical = normalizeDateValue(value)
  if (!canonical.valid || canonical.ongoing || !canonical.value) return { ok: false, value: '', reason: '日期值无法规范化' }
  if (!(element instanceof HTMLInputElement)) return { ok: true, value: canonical.value }
  if (element.type === 'month') {
    const match = canonical.value.match(/^\d{4}-\d{2}/)
    return match ? { ok: true, value: match[0] } : { ok: false, value: '', reason: '月份控件需要 YYYY-MM' }
  }
  if (element.type === 'date') {
    return /^\d{4}-\d{2}-\d{2}$/.test(canonical.value)
      ? { ok: true, value: canonical.value }
      : { ok: false, value: '', reason: '日期控件需要完整年月日' }
  }
  return { ok: true, value: canonical.value }
}

function partElement(group: ControlGroup, role: ControlPartRole, doc: Document): Element | null {
  const part = group.parts.find((candidate) => candidate.role === role)
  return part ? resolveElement(part.ref, doc) : null
}

function writeText(el: Element, value: string): { written: boolean; actual: string; truncated: boolean } {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const maxLength = el.maxLength > 0 ? el.maxLength : Infinity
    const next = value.slice(0, maxLength)
    setNativeValue(el, next)
    commitBlur(el)
    return { written: true, actual: el.value, truncated: next !== value }
  }
  if ((el as HTMLElement).isContentEditable) {
    el.textContent = value
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }))
    commitBlur(el)
    return { written: true, actual: el.textContent ?? '', truncated: false }
  }
  return { written: false, actual: '', truncated: false }
}

function chooseNativeSelect(select: HTMLSelectElement, value: string): boolean {
  const option = Array.from(select.options).find((item) => {
    const text = item.textContent?.trim() ?? ''
    return norm(item.value) === norm(value) || norm(text) === norm(value) || isSynonym(text, value)
  })
  if (!option) return false
  const optionText = option.textContent?.trim() ?? option.value
  select.value = option.value
  select.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
  commitBlur(select)
  if (select.value !== option.value) return false
  if (select.classList.contains('selectpicker')) {
    const mirror = select.parentElement?.querySelector('.filter-option-inner-inner, .filter-option, button.dropdown-toggle')
      ?? select.closest('.bootstrap-select')?.querySelector('.filter-option-inner-inner, .filter-option, button.dropdown-toggle')
    if (mirror && !valueMatches(mirror.textContent ?? '', optionText)) return false
  }
  return true
}

function overlayFor(root: Element, doc: Document): Element | null {
  const controlId = root.getAttribute('aria-controls') || root.querySelector('[aria-controls]')?.getAttribute('aria-controls')
  if (controlId) {
    const linked = doc.getElementById(controlId)
    if (linked && visible(linked)) return linked
  }
  const candidates = Array.from(doc.querySelectorAll([
    '[role="listbox"]', '.ant-select-dropdown', '.el-select-dropdown', '.arco-select-popup',
    '.kuma-select2-dropdown', '.select2-dropdown', '.moka-search-dropdown', '[class*="dropdown-menu"]',
  ].join(','))).filter(visible)
  return candidates.at(-1) ?? null
}

function optionFor(overlay: Element, value: string): Element | null {
  const options = Array.from(overlay.querySelectorAll('[role="option"], option, li, [class*="option"]')).filter(visible)
  const exact = options.find((item) => norm(item.textContent ?? '') === norm(value))
  return exact ?? options.find((item) => isSynonym(item.textContent ?? '', value))
    ?? options.find((item) => valueMatches(item.textContent ?? '', value)) ?? null
}

function optionTexts(root: Element): string[] {
  return Array.from(root.querySelectorAll('[role="option"], option, li, [class*="option"]'))
    .filter(visible)
    .map((item) => item.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(Boolean)
}

/** Read safe option labels for an agent inspection call. It never commits a selection. */
export async function inspectControlOptions(
  field: PageField,
  query = '',
  doc: Document = document,
): Promise<{ options: string[]; opened: boolean; message: string }> {
  const group = field.control
  const root = resolveElement(group.root, doc)
  if (!root) return { options: [], opened: false, message: '控件引用已失效' }
  if (root instanceof HTMLSelectElement) {
    return { options: Array.from(root.options).map((item) => item.textContent?.trim() ?? '').filter(Boolean).slice(0, 50), opened: false, message: '已读取原生选项' }
  }
  if (group.kind === 'radio-group') {
    const options = group.parts.map((candidate) => resolveElement(candidate.ref, doc)).flatMap((radio) => {
      if (!(radio instanceof HTMLInputElement)) return []
      const label = radio.id ? doc.querySelector(`label[for="${CSS.escape(radio.id)}"]`)?.textContent : radio.closest('label')?.textContent
      return [String(label ?? radio.value).trim()].filter(Boolean)
    })
    return { options: Array.from(new Set(options)).slice(0, 50), opened: false, message: '已读取单选项' }
  }
  if (!['custom-select', 'combobox', 'cascader'].includes(group.kind)) {
    return { options: group.options.slice(0, 50), opened: false, message: '该控件没有动态选项' }
  }

  const trigger = partElement(group, 'trigger', doc) ?? root
  const input = partElement(group, 'input', doc) ?? root.querySelector('input')
  const previous = input instanceof HTMLInputElement ? input.value : ''
  ;(trigger as HTMLElement).click()
  if (query && input instanceof HTMLInputElement) setNativeValue(input, query)
  const opened = await waitFor(() => !!overlayFor(root, doc), 1000)
  const overlay = overlayFor(root, doc)
  const options = overlay ? optionTexts(overlay).slice(0, 50) : []
  if (input instanceof HTMLInputElement) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    if (query && input.value !== previous) setNativeValue(input, previous)
  }
  return { options, opened, message: opened ? '已读取关联弹层选项' : '下拉弹层未打开' }
}

async function chooseCustom(fieldId: string, group: ControlGroup, value: string, doc: Document): Promise<ControlExecutionResult> {
  const root = resolveElement(group.root, doc)
  if (!root) return result(fieldId, { failureClass: 'stale-ref', message: '自定义下拉引用已失效' })
  const trigger = partElement(group, 'trigger', doc) ?? root
  const input = partElement(group, 'input', doc) ?? root.querySelector('input')
  ;(trigger as HTMLElement).click()
  if (input instanceof HTMLInputElement) {
    setNativeValue(input, value)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  }
  const opened = await waitFor(() => !!overlayFor(root, doc), 1000)
  const overlay = overlayFor(root, doc)
  if (!opened || !overlay) {
    return result(fieldId, { written: input instanceof HTMLInputElement, failureClass: 'control', message: '下拉弹层未打开，输入文字不计为选中' })
  }
  const optionReady = await waitFor(() => !!optionFor(overlay, value), 1500)
  const option = optionFor(overlay, value)
  if (!optionReady || !option) {
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return result(fieldId, { written: input instanceof HTMLInputElement, failureClass: 'validation', message: '关联弹层中没有匹配选项' })
  }
  ;(option as HTMLElement).click()
  const committed = await waitFor(() => valueMatches(selectedText(root), value), 1500)
  return committed
    ? result(fieldId, { state: 'verified', written: true, committed: true, verified: true, message: '下拉选项已选择并读回' })
    : result(fieldId, { written: true, failureClass: 'control', message: '点击选项后未读到已选状态' })
}

function writeCheckbox(el: Element, checked: boolean): boolean {
  if (!(el instanceof HTMLInputElement) || el.type !== 'checkbox') return false
  if (el.checked !== checked) el.click()
  return el.checked === checked
}

function chooseRadio(group: ControlGroup, value: string, doc: Document): boolean {
  const radios = group.parts
    .map((part) => resolveElement(part.ref, doc))
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === 'radio')
  const target = radios.find((radio) => {
    const label = radio.id ? doc.querySelector(`label[for="${CSS.escape(radio.id)}"]`)?.textContent : radio.closest('label')?.textContent
    return norm(radio.value) === norm(value) || norm(label ?? '') === norm(value) || isSynonym(label ?? '', value)
  })
  if (!target) return false
  if (!target.checked) target.click()
  return target.checked
}

function writeDatePart(part: ControlPart, value: string, doc: Document): boolean {
  const el = resolveElement(part.ref, doc)
  if (!el) return false
  if (part.role === 'current-toggle') return writeCheckbox(el, value === '是')
  if (el instanceof HTMLSelectElement) return chooseNativeSelect(el, value)
  const written = writeText(el, value)
  return written.written && written.actual === value
}

function readDatePart(part: ControlPart, expected: string, doc: Document): boolean {
  const el = resolveElement(part.ref, doc)
  if (!el) return false
  if (part.role === 'current-toggle') return el instanceof HTMLInputElement && el.checked === (expected === '是')
  if (el instanceof HTMLSelectElement) return valueMatches(el.value, expected) || valueMatches(el.selectedOptions[0]?.textContent ?? '', expected)
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value === expected
  return false
}

async function executeDateParts(request: ControlExecutionRequest, doc: Document): Promise<ControlExecutionResult> {
  if (request.value.kind !== 'parts') return result(request.field.id, { failureClass: 'semantic', message: '拆分日期缺少 parts 值' })
  const projected = request.value
  const group = request.field.control
  const expectedParts = group.parts.filter((part) => part.role in projected.parts)
  if (expectedParts.length === 0) return result(request.field.id, { failureClass: 'control', message: '页面日期控件没有可写部分' })
  const written = expectedParts.every((part) => writeDatePart(part, projected.parts[part.role], doc))
  if (!written) return result(request.field.id, { written: true, failureClass: 'control', message: '日期至少一个部分写入失败' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const verified = expectedParts.every((part) => readDatePart(part, projected.parts[part.role], doc))
  return verified
    ? result(request.field.id, { state: 'verified', written: true, committed: true, verified: true, message: '日期各部分均已读回' })
    : result(request.field.id, { written: true, committed: true, failureClass: 'control', message: '日期部分读回不一致' })
}

function splitRangeValue(value: string): { start: string; end: string; current: boolean } {
  const current = /至今|现在|在读|在职|进行中/.test(value)
  const cleaned = value.replace(/至今|现在|在读|在职|进行中/g, '').trim()
  const parts = cleaned.split(/\s*(?:~|～|到|至|—|–)\s*|\s+-\s+/, 2)
  return { start: parts[0] ?? '', end: current ? '' : (parts[1] ?? ''), current }
}

async function executeDateRange(request: ControlExecutionRequest, value: string, doc: Document): Promise<ControlExecutionResult> {
  const group = request.field.control
  const range = splitRangeValue(value)
  const expected: Partial<Record<ControlPartRole, string>> = { start: range.start, end: range.end, 'current-toggle': range.current ? '是' : '否' }
  const parts = group.parts.filter((part) => part.role in expected)
  if (parts.length < 2) return result(request.field.id, { failureClass: 'control', message: '日期区间缺少起止控件' })
  const dateParts = parts.filter((part) => part.role !== 'current-toggle')
  const toggle = parts.find((part) => part.role === 'current-toggle')
  const writtenDates = dateParts.every((part) => writeDatePart(part, expected[part.role] ?? '', doc))
  const writtenToggle = !toggle || writeDatePart(toggle, expected['current-toggle'] ?? '否', doc)
  const written = writtenDates && writtenToggle
  const verifiedDates = dateParts.every((part) => {
    if (range.current && part.role === 'end') {
      const el = resolveElement(part.ref, doc)
      const actual = el instanceof HTMLInputElement ? el.value : ''
      return actual === '' || /至今|现在|在读|在职|进行中/.test(actual)
    }
    return readDatePart(part, expected[part.role] ?? '', doc)
  })
  const verified = written && verifiedDates && (!toggle || readDatePart(toggle, expected['current-toggle'] ?? '否', doc))
  return verified
    ? result(request.field.id, { state: 'verified', written: true, committed: true, verified: true, message: '日期区间已逐项读回' })
    : result(request.field.id, { written, committed: written, failureClass: 'control', message: '日期区间写入或读回失败' })
}

export async function executeControl(request: ControlExecutionRequest, doc: Document = document): Promise<ControlExecutionResult> {
  if (request.value.kind === 'missing') return result(request.field.id, { state: 'manual', failureClass: 'semantic', message: request.value.reason })
  const group = request.field.control
  if (group.disabled || group.currentState === 'locked') {
    return result(request.field.id, { state: 'manual', failureClass: 'control', message: '控件不可编辑' })
  }
  if (group.kind === 'date-parts' || group.kind === 'date-range-parts') return executeDateParts(request, doc)
  const value = scalarValue(request)
  if (value === null) return result(request.field.id, { failureClass: 'semantic', message: '控件需要单值' })
  const root = resolveElement(group.root, doc)
  if (!root) return result(request.field.id, { failureClass: 'stale-ref', message: '控件引用已失效' })

  if (group.kind === 'custom-select' || group.kind === 'combobox') return chooseCustom(request.field.id, group, value, doc)
  if (group.kind === 'date-range') return executeDateRange(request, value, doc)
  if (group.kind === 'date-single') {
    const input = partElement(group, 'input', doc) ?? root
    const target = dateValueForElement(value, input)
    if (!target.ok) {
      return result(request.field.id, { state: 'manual', failureClass: 'validation', message: `${target.reason}，未写入页面` })
    }
    const write = writeText(input, target.value)
    return write.written && write.actual === target.value
      ? result(request.field.id, { state: 'verified', written: true, committed: true, verified: true, message: '日期已写入并读回' })
      : result(request.field.id, { written: write.written, failureClass: 'control', message: '日期写入后读回不一致' })
  }
  if (group.kind === 'radio-group') {
    const verified = chooseRadio(group, value, doc)
    return verified
      ? result(request.field.id, { state: 'verified', written: true, committed: true, verified: true, message: '单选项已选择并读回' })
      : result(request.field.id, { failureClass: 'validation', message: '没有匹配的单选项' })
  }
  if (group.kind === 'native-select' && root instanceof HTMLSelectElement) {
    const selected = chooseNativeSelect(root, value)
    return selected
      ? result(request.field.id, { state: 'verified', written: true, committed: true, verified: true, message: '原生下拉已选择并读回' })
      : result(request.field.id, { failureClass: 'validation', message: '原生下拉没有匹配选项' })
  }
  if (group.kind === 'checkbox') {
    const checked = /^(是|true|1|yes)$/i.test(value)
    const verified = writeCheckbox(root, checked)
    return verified
      ? result(request.field.id, { state: 'verified', written: true, committed: true, verified: true, message: '复选状态已读回' })
      : result(request.field.id, { failureClass: 'control', message: '复选框写入失败' })
  }
  const write = writeText(root, value)
  if (!write.written) return result(request.field.id, { failureClass: 'control', message: '控件不支持文本写入' })
  if (write.truncated) return result(request.field.id, { state: 'manual', written: true, committed: true, failureClass: 'validation', message: '内容超过 maxlength，已截断并等待确认' })
  return write.actual === value
    ? result(request.field.id, { state: 'verified', written: true, committed: true, verified: true, message: '文本已写入并读回' })
    : result(request.field.id, { written: true, failureClass: 'control', message: '文本写入后读回不一致' })
}

/** Fresh, read-only verification for an already executed semantic value. */
export function verifyControlValue(field: PageField, expected: ProjectedValue, doc: Document = document): ControlExecutionResult {
  const group = field.control
  const root = resolveElement(group.root, doc)
  if (!root) return result(field.id, { failureClass: 'stale-ref', message: '复验时控件引用已失效' })
  if (expected.kind === 'missing') return result(field.id, { state: 'manual', failureClass: 'semantic', message: expected.reason })
  if (expected.kind === 'parts') {
    const parts = group.parts.filter((part) => part.role in expected.parts)
    const verified = parts.length > 0 && parts.every((part) => readDatePart(part, expected.parts[part.role], doc))
    return verified
      ? result(field.id, { state: 'verified', written: true, committed: true, verified: true, message: '日期部件复验通过' })
      : result(field.id, { written: true, committed: true, failureClass: 'control', message: '日期部件复验不一致' })
  }

  const value = expected.value
  if (group.kind === 'custom-select' || group.kind === 'combobox' || group.kind === 'cascader') {
    const verified = valueMatches(selectedText(root), value)
    return verified
      ? result(field.id, { state: 'verified', written: true, committed: true, verified: true, message: '下拉已选状态复验通过' })
      : result(field.id, { written: true, failureClass: 'control', message: '未读到下拉已选状态' })
  }
  if (group.kind === 'native-select' && root instanceof HTMLSelectElement) {
    const verified = valueMatches(root.value, value) || valueMatches(root.selectedOptions[0]?.textContent ?? '', value)
    return verified
      ? result(field.id, { state: 'verified', written: true, committed: true, verified: true, message: '原生下拉复验通过' })
      : result(field.id, { written: true, failureClass: 'validation', message: '原生下拉复验不一致' })
  }
  if (group.kind === 'checkbox') {
    const verified = root instanceof HTMLInputElement && root.checked === /^(是|true|1|yes)$/i.test(value)
    return verified
      ? result(field.id, { state: 'verified', written: true, committed: true, verified: true, message: '复选状态复验通过' })
      : result(field.id, { written: true, failureClass: 'control', message: '复选状态复验不一致' })
  }
  if (group.kind === 'radio-group') {
    const checked = group.parts.map((part) => resolveElement(part.ref, doc))
      .find((element): element is HTMLInputElement => element instanceof HTMLInputElement && element.checked)
    const label = checked?.id ? doc.querySelector(`label[for="${CSS.escape(checked.id)}"]`)?.textContent : checked?.closest('label')?.textContent
    const verified = !!checked && (valueMatches(checked.value, value) || valueMatches(label ?? '', value) || isSynonym(label ?? '', value))
    return verified
      ? result(field.id, { state: 'verified', written: true, committed: true, verified: true, message: '单选状态复验通过' })
      : result(field.id, { written: true, failureClass: 'validation', message: '单选状态复验不一致' })
  }
  const target = partElement(group, 'input', doc) ?? root
  const actual = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    ? target.value
    : (target as HTMLElement).textContent ?? ''
  const projected = group.kind === 'date-single' ? dateValueForElement(value, target) : { ok: true, value }
  if (!projected.ok) return result(field.id, { state: 'manual', failureClass: 'validation', message: projected.reason ?? '日期精度不兼容' })
  const normalizedExpected = projected.value
  const verified = actual === normalizedExpected
  return verified
    ? result(field.id, { state: 'verified', written: true, committed: true, verified: true, message: '字段值复验通过' })
    : result(field.id, { written: true, failureClass: 'control', message: '字段值复验不一致' })
}
