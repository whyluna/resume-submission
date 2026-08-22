import type { AdapterId } from '@/shared/pageModel'
import type { AdapterContext, AdapterMatch } from './contracts'

function has(doc: Document, selector: string): boolean {
  try { return !!doc.querySelector(selector) } catch { return false }
}

export function detectAdapter(context: AdapterContext): AdapterMatch {
  const { document: doc, url } = context
  const matches: AdapterMatch[] = []
  const add = (id: AdapterId, score: number, ...reasons: string[]) => matches.push({ id, score, reasons })

  if (/talent\.alibaba\.com/i.test(url)) add('kuma', 100, 'Alibaba talent URL')
  if (has(doc, '[class*="kuma-"]')) add('kuma', 95, 'Kuma component classes')

  if (/mokahr\.com/i.test(url)) add('moka', 100, 'Moka URL')
  if (has(doc, '[class*="moka-"]')) add('moka', 90, 'Moka component classes')
  if (has(doc, '.search-box') && has(doc, '.ant-picker') && has(doc, '.item-card')) {
    add('moka', 88, 'Moka resume card/search/date structure')
  }

  if (/\/wt\/[^/]+\/web/i.test(url)) add('dayee-wt', 100, 'Dayee WT URL path')
  if (/hotjob\.cn/i.test(url)) add('dayee-wt', 95, 'hotjob.cn tenant')
  if (has(doc, '.dayType, .selectpicker, [class*="wtspe-"]')) add('dayee-wt', 90, 'Dayee WT component signatures')

  if (/(italent\.cn|beisen\.com|zhiye\.com)/i.test(url)) add('beisen', 100, 'Beisen URL')

  return matches.sort((a, b) => b.score - a.score)[0] ?? { id: 'generic', score: 10, reasons: ['Generic fallback'] }
}
