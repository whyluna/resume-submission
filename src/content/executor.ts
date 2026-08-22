import type { FieldEl, ItemStatus } from '@/shared/types'
import { isSynonym, norm, sleep } from '@/shared/util'
import { fillCascader, fillCustomDate, fillCustomSelect, pickDropdownOption } from './widgets'
import { resolveRef } from './scanner'

const HL_COLOR: Record<ItemStatus, string> = {
  filled: 'rgba(34,197,94,.55)',   // 绿：高置信已填
  review: 'rgba(249,115,22,.75)',  // 橙：低置信/需确认
  failed: 'rgba(239,68,68,.65)',   // 红：填写失败
  skipped: 'rgba(234,179,8,.6)',   // 黄：需手动（上传等）
}

export function highlight(el: Element, status: ItemStatus): void {
  const html = el as HTMLElement
  html.style.outline = `2px solid ${HL_COLOR[status]}`
  html.style.outlineOffset = '1px'
  html.dataset.rsFilled = status
}

function fire(el: Element, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
}

/** React/Vue 受控组件安全的取值写法：原生 setter + input/change 事件 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
  if (descriptor?.set) descriptor.set.call(el, value)
  else el.value = value
}

function adaptDate(input: HTMLInputElement, value: string): string {
  const ym = value.match(/^(\d{4})[-/.](\d{1,2})/)
  if (!ym) return value
  const [, y, m] = ym
  if (input.type === 'month') return `${y}-${m.padStart(2, '0')}`
  if (input.type === 'date') {
    const day = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)?.[3]
    return `${y}-${m.padStart(2, '0')}-${(day ?? '1').padStart(2, '0')}`
  }
  return value
}

/** 对一个字段执行写入。返回 null=成功；字符串=失败原因 */
export async function applyField(field: FieldEl, value: string): Promise<string | null> {
  const el = field.el
  if (!value) return '档案中无对应值'
  const delay = 20 + Math.random() * 60 // 轻微随机延迟，贴近真人操作
  await new Promise((r) => setTimeout(r, delay))

  if (el instanceof HTMLSelectElement) {
    const opts = Array.from(el.options)
    const hit = opts.find((o) => norm(o.textContent) === norm(value) || norm(o.value) === norm(value))
      ?? opts.find((o) => isSynonym(o.textContent ?? '', value))
      ?? opts.find((o) => norm(o.textContent ?? '').includes(norm(value)) || norm(value).includes(norm(o.textContent ?? '')))
    if (!hit) return `下拉选项中找不到"${value}"（共 ${opts.length} 项）`
    el.value = hit.value
    fire(el, 'input')
    fire(el, 'change')
    return null
  }

  // ---- 自定义组件（包装层元素，非原生控件）----
  if (field.control === 'customselect') return fillCustomSelect(el, value)
  if (field.control === 'cascader') return fillCascader(el, value)
  if (field.control === 'date' && !(el instanceof HTMLInputElement)) return fillCustomDate(el, value)

  if (el instanceof HTMLInputElement && el.type === 'radio') {
    const scope = el.closest('form,fieldset,body') ?? document.body
    const group = el.name
      ? Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]`))
      : [el]
    const target = group.find((r) => {
      const text = (r.closest('label')?.textContent ?? r.parentElement?.textContent ?? r.value).trim()
      return isSynonym(text, value) || norm(text).includes(norm(value))
    })
    if (!target) return `选项中找不到"${value}"`
    target.click()
    fire(target, 'input')
    fire(target, 'change')
    highlight(target, 'filled')
    return null
  }

  if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    const want = ['是', '有', '同意', 'yes', 'true', '已'].some((k) => norm(value).includes(norm(k)))
    const checked = (el as HTMLInputElement).checked
    if (checked !== want) el.click()
    fire(el, 'input')
    fire(el, 'change')
    return null
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    let v = value
    if (el instanceof HTMLInputElement && el.type !== 'text') {
      // "至今"类值无法写入 date/month 控件，留给用户勾选页面上的至今选项
      if (/至今|现在/.test(v)) return '[待确认] 值为"至今"，日期控件需手动选择或勾选页面"至今"选项'
      v = adaptDate(el, value)
    }
    if (el.maxLength > 0 && v.length > el.maxLength) v = v.slice(0, el.maxLength)
    el.focus()
    setNativeValue(el, v)
    fire(el, 'input')
    fire(el, 'change')
    fire(el, 'blur')
    // 联想式下拉（学校/专业等）：输入后弹出选项时自动点选匹配项
    await pickDropdownOption(el, value)
    // 读回校验：SPA 可能在写后重渲染元素，重新按 ref 定位再读，norm 后宽松对比
    await sleep(80)
    const fresh = resolveRef(field.ref)
    const live = (fresh instanceof HTMLInputElement || fresh instanceof HTMLTextAreaElement ? fresh : el)
    if (norm(live.value) !== norm(v)) return '[待确认] 读回校验不一致（组件可能改写了值）'
    return null
  }

  if ((el as HTMLElement).isContentEditable) {
    ;(el as HTMLElement).focus()
    document.execCommand('selectAll', false)
    document.execCommand('insertText', false, value)
    if (!el.textContent?.includes(value.slice(0, 10))) return '富文本写入未生效'
    return null
  }

  return `暂不支持的控件类型 ${field.control}`
}
