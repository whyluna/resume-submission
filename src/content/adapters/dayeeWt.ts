import type { PageAdapter } from './contracts'

export const DAYEE_WT = {
  rowSelector: '.resume-row, .ipt-item',
  labelSelector: '.field-title, .ipt-title, .control-label',
  entrySelector: '[class*="entry"], [class*="record"]',
  dateSelector: 'input.dayType',
  selectSelector: 'select.selectpicker',
  addSelector: 'a.add-more, [class*="add-more"]',
} as const

export const dayeeWtAdapter: PageAdapter = {
  id: 'dayee-wt',
  maturity: 'fixture-verified',
  match({ document, url }) {
    const reasons: string[] = []
    let score = 0
    if (/\/wt\/[^/]+\/web/i.test(url)) { score += 100; reasons.push('WT URL') }
    if (document.querySelector('.dayType, .selectpicker, [class*="wtspe-"]')) { score += 40; reasons.push('WT controls') }
    return { id: 'dayee-wt', score, reasons }
  },
}
