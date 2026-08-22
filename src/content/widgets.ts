/**
 * 自定义组件适配器：antd / Element / Arco / Moka 等组件库的下拉、级联、日期。
 * 通用策略：点开浮层 → 在可见浮层里按文本匹配选项 → 点选 → 弱回读校验。
 * 浮层由组件库挂到 body（portal），匹配时必须过滤可见性并排除字段自身子树。
 */
import { isSynonym, norm, sleep } from '@/shared/util'

const OPTION_SEL = [
  '.ant-select-item-option',
  '.el-select-dropdown__item',
  '.arco-select-option',
  'li[role="option"]',
  '[class*="select-option"]',
  '[class*="select-item"]',
  '[class*="option-item"]',
  '[class*="dropdown-item"]',
  '[class*="suggestion"]',
].join(', ')

const CASCADER_COL = '.ant-cascader-menu, .arco-cascader-list-col, [class*="cascader-menu"], [class*="cascader-column"]'
const CASCADER_NODE = '[class*="cascader-menu-item"], [class*="cascader-option"], li'

/** 级联的"列"：匹配容器时要把 menu-item（选项本身也含 cascader-menu 字样）剔除，否则最后一列是个 li */
function cascaderColumns(): Element[] {
  return Array.from(document.querySelectorAll(CASCADER_COL))
    .filter((c) => visible(c) && !/menu-item|option/i.test(String((c as HTMLElement).className)))
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

async function waitFor<T>(fn: () => T | null, timeout = 2500, interval = 120): Promise<T | null> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = fn()
    if (v) return v
    await sleep(interval)
  }
  return null
}

function matchScore(text: string, value: string): number {
  const nt = norm(text)
  const nv = norm(value)
  if (!nt || !nv) return 0
  if (nt === nv) return 100
  if (isSynonym(text, value)) return 90
  if (nt.includes(nv) || nv.includes(nt)) return 70
  return 0
}

function pressEscape(el: Element): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  document.activeElement?.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
}

function pressEnter(el: Element): void {
  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  }
}

/** React/Vue 受控组件安全的输入写入 */
function typeInto(input: HTMLInputElement, value: string): void {
  input.focus()
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  desc?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 组件回显文本是否已包含目标值（点选成功的弱校验） */
function wrapperShows(wrapper: Element, value: string): boolean {
  const t = norm(wrapper.textContent ?? '')
  const v = norm(value)
  return !!v && t.includes(v)
}

/** 在当前打开的可见浮层里找最匹配的选项 */
function bestVisibleOption(value: string, exclude: Element): Element | null {
  let best: { el: Element; s: number } | null = null
  for (const o of Array.from(document.querySelectorAll(OPTION_SEL))) {
    if (!visible(o) || exclude.contains(o)) continue
    const s = matchScore(o.textContent ?? '', value)
    if (s > (best?.s ?? 0)) best = { el: o, s }
  }
  return best && best.s >= 70 ? best.el : null
}

/**
 * 自定义下拉：点触发器 → 浮层匹配 → 点选。
 * 搜索式下拉（学校/专业等 type-to-search）：触发器点开没有选项时，走 输入→等联想→点选。
 * 返回 null=成功；字符串=需人工复核的原因（不视为硬失败，值可能已输入待确认）。
 */
export async function fillCustomSelect(wrapper: Element, value: string): Promise<string | null> {
  const trigger = (wrapper.querySelector('[class*="selector"], [class*="selection"], [class*="wrapper"]') ?? wrapper) as HTMLElement
  trigger.click()
  let opt = await waitFor(() => bestVisibleOption(value, wrapper), 1200)

  // 搜索式下拉：点开没有（或没匹配的）选项 → 在可编辑输入框里键入触发联想
  if (!opt) {
    const editable = Array.from(wrapper.querySelectorAll<HTMLInputElement>('input'))
      .find((i) => !i.readOnly && !i.disabled && visible(i))
    if (editable) {
      typeInto(editable, value)
      opt = await waitFor(() => bestVisibleOption(value, wrapper), 2500)
      if (!opt) {
        // 联想没出来或没匹配项：Enter 尝试直接确认输入值（部分组件支持）
        pressEnter(editable)
        await sleep(200)
        if (wrapperShows(wrapper, value)) return null
        pressEscape(wrapper)
        return `[待确认] 搜索下拉未匹配「${value}」，已输入原值待人工确认`
      }
    }
  }

  if (!opt) {
    pressEscape(trigger)
    return `自定义下拉中未找到匹配「${value}」的选项`
  }
  ;(opt as HTMLElement).click()
  await sleep(250)
  if (wrapperShows(wrapper, value)) return null
  // 点击未生效（组件可能要求键盘确认）：重新输入 + Enter
  const editable = Array.from(wrapper.querySelectorAll<HTMLInputElement>('input')).find((i) => !i.readOnly && visible(i))
  if (editable) {
    typeInto(editable, value)
    await sleep(150)
    pressEnter(editable)
    await sleep(200)
    if (wrapperShows(wrapper, value)) return null
  }
  return `[待确认] 下拉点选后未回显「${value}」，请手动确认`
}

/**
 * 普通输入框输入后弹出联想（任意框架的 type-to-search，未被识别为自定义组件时）：
 * 有联想信号（combobox/search 类）等 900ms，否则只等 250ms；出现匹配的可见选项则点选。
 * 返回 true=已点选。
 */
export async function pickDropdownOption(input: Element, value: string): Promise<boolean> {
  const el = input as HTMLInputElement
  const sig = [el.getAttribute('role'), el.getAttribute('aria-haspopup'), el.getAttribute('aria-autocomplete'),
    el.className, el.name, el.id, el.placeholder].join(' ')
  const grace = /combobox|listbox|autocomplete|search|select|combo|搜索/i.test(sig) ? 900 : 250
  const t0 = Date.now()
  let opt: Element | null = null
  while (Date.now() - t0 < grace) {
    opt = bestVisibleOption(value, input)
    if (opt) break
    await sleep(100)
  }
  if (!opt) return false
  ;(opt as HTMLElement).click()
  await sleep(200)
  return true
}

/** 找邻近的「至今」复选框（同表单行内） */
function nearbyNowCheckbox(el: Element): HTMLInputElement | null {
  const scope = el.parentElement?.parentElement ?? el.parentElement
  if (!scope) return null
  for (const cb of Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
    const text = cb.closest('label')?.textContent ?? cb.parentElement?.textContent ?? ''
    if (/至今|现在|在读/.test(text)) return cb
  }
  return null
}

function writePickerInput(input: HTMLInputElement, value: string): void {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  desc?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.dispatchEvent(new Event('blur', { bubbles: true }))
}

/**
 * 自定义日期（ant-picker 等）：内部是真实 input（常带 readonly）。
 * 原生 setter + input/change 事件可触发组件库的 onChange（readonly 只挡用户键入）。
 * 区间组件（起止两个 input）：值按 ~ 或 至今 拆分，分别写入；「至今」优先勾选邻近复选框。
 */
export async function fillCustomDate(wrapper: Element, value: string): Promise<string | null> {
  const inputs = Array.from(wrapper.querySelectorAll<HTMLInputElement>('input')).filter((i) => visible(i))
  if (inputs.length === 0) return '日期组件内无输入框'

  const isNow = /至今|现在/.test(value)
  const cleaned = value.replace(/至今|现在/g, '')
  const parts = cleaned.split(/~|～|到|—|–|-{1,2}(?=\s*\d{4})/).map((s) => s.trim()).filter(Boolean)

  if (inputs.length >= 2 && (parts.length >= 2 || isNow)) {
    const [start, end] = parts
    writePickerInput(inputs[0], start ?? '')
    if (isNow) {
      const cb = nearbyNowCheckbox(wrapper)
      if (cb) {
        if (!cb.checked) cb.click()
        await sleep(120)
        return null
      }
      // 没有至今复选框：结束框留空提示
      writePickerInput(inputs[1], '')
      return '[待确认] 结束时间为"至今"，请勾选页面"至今"选项'
    }
    writePickerInput(inputs[1], end ?? '')
    await sleep(150)
    const okStart = !start || norm(inputs[0].value).includes(norm(start))
    const okEnd = !end || norm(inputs[1].value).includes(norm(end))
    return okStart && okEnd ? null : '日期区间写入未生效，请手动选择'
  }

  // 单输入框：写入起始值（区间值落单框时取前半）
  const v = parts[0] ?? value
  if (isNow) {
    const cb = nearbyNowCheckbox(wrapper)
    if (cb) {
      if (!cb.checked) cb.click()
      await sleep(120)
      return null
    }
    return '[待确认] 值为"至今"，日期控件需手动选择或勾选页面"至今"选项'
  }
  writePickerInput(inputs[0], v)
  await sleep(150)
  return norm(inputs[0].value) === norm(v) ? null : '日期组件写入未生效，请手动选择'
}

/** 级联选择（省市区）：按空格/斜杠拆层级，逐级在最后一列点匹配节点 */
export async function fillCascader(wrapper: Element, value: string): Promise<string | null> {
  const parts = value.split(/[\s/／、,，]+/).filter(Boolean)
  if (parts.length === 0) return '级联值为空'
  const trigger = (wrapper.querySelector('input') ?? wrapper) as HTMLElement
  trigger.click()
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const node = await waitFor(() => {
      const cols = cascaderColumns()
      const col = cols[cols.length - 1]
      if (!col) return null
      let best: { el: Element; s: number } | null = null
      for (const n of Array.from(col.querySelectorAll(CASCADER_NODE))) {
        if (!visible(n)) continue
        const s = matchScore(n.textContent ?? '', part)
        if (s > (best?.s ?? 0)) best = { el: n, s }
      }
      return best && best.s >= 70 ? best.el : null
    })
    if (!node) {
      pressEscape(wrapper)
      return `级联第 ${i + 1} 级未找到「${part}」`
    }
    ;(node as HTMLElement).click()
    await sleep(250)
  }
  return null
}
