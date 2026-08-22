import type { PageAdapter } from './contracts'

export const MOKA = {
  entrySelector: '.education-card, .project-card, .edu-card, .proj-card, .award-card, .item-card',
  searchRootSelector: '.search-box, .deep-control',
  searchInputSelector: 'input.moka-school, input.moka-major, .search-box input',
  dateRootSelector: '.moka-date-parts, .ant-picker',
  dropdownSelector: '.moka-search-dropdown, .ant-select-dropdown',
  selectedSelector: '.ant-select-selection-item, [data-value]:not(input)',
} as const

export const mokaAdapter: PageAdapter = {
  id: 'moka',
  maturity: 'fixture-verified',
  match({ document, url }) {
    const reasons: string[] = []
    let score = 0
    if (/mokahr\.com/i.test(url)) { score += 100; reasons.push('Moka URL') }
    if (document.querySelector('[class*="moka-"], .moka-date-parts, .search-box')) { score += 40; reasons.push('Moka controls') }
    return { id: 'moka', score, reasons }
  },
}
