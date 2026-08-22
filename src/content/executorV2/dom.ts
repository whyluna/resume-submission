import type { ElementRefV2 } from '@/shared/pageModel'
import { norm } from '@/shared/util'

export function resolveElement(ref: ElementRefV2, doc: Document = document): Element | null {
  try {
    const matches = Array.from(doc.querySelectorAll(ref.cssPath))
    return matches[ref.index] ?? matches[0] ?? null
  } catch {
    return null
  }
}

export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}

export function commitBlur(el: Element): void {
  el.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true }))
  ;(el as HTMLElement).blur?.()
}

export function visible(el: Element): boolean {
  const html = el as HTMLElement
  if (html.hidden || el.getAttribute('aria-hidden') === 'true') return false
  const style = html.style
  return style.display !== 'none' && style.visibility !== 'hidden'
}

export function selectedText(root: Element): string {
  const selected = root.querySelector([
    '[aria-selected="true"]', '.ant-select-selection-item', '.el-select__selected-item',
    '.arco-select-view-value', '.kuma-select2-selection-rendered', '.selected-label',
  ].join(','))
  if (selected?.textContent?.trim()) return selected.textContent.trim()
  if (root instanceof HTMLSelectElement) return root.selectedOptions[0]?.textContent?.trim() ?? root.value
  return ''
}

export function valueMatches(actual: string, expected: string): boolean {
  const a = norm(actual)
  const e = norm(expected)
  return !!a && !!e && (a === e || a.includes(e) || e.includes(a))
}

export async function waitFor(check: () => boolean, timeoutMs = 1500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  do {
    if (check()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  } while (Date.now() < deadline)
  return false
}
