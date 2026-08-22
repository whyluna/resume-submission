import type { PageAdapter } from './contracts'

export const KUMA = {
  fieldSelector: '.kuma-uxform-field-core',
  labelSelector: '.kuma-uxform-field-label',
  selectSelector: '.kuma-select2',
  dateSelector: '.kuma-date-uxform-field-cascade',
  addSelector: '.kuma-add-action',
} as const

export const kumaAdapter: PageAdapter = {
  id: 'kuma',
  maturity: 'fixture-verified',
  match({ document, url }) {
    const reasons: string[] = []
    let score = 0
    if (/talent\.alibaba\.com/i.test(url)) { score += 100; reasons.push('Alibaba talent URL') }
    if (document.querySelector('[class*="kuma-"]')) { score += 40; reasons.push('Kuma controls') }
    return { id: 'kuma', score, reasons }
  },
}
