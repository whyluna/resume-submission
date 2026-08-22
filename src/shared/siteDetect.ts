export interface SiteMatch {
  siteName: string
  adapter: 'moka' | 'beisen' | 'nowcoder' | 'dayee' | 'zhaopin' | 'generic'
  confidence: number
}

const RULES: Array<{ test: RegExp; match: Omit<SiteMatch, 'confidence'> }> = [
  { test: /mokahr\.com/i, match: { siteName: 'Moka 招聘系统', adapter: 'moka' } },
  { test: /(italent\.cn|beisen\.com)/i, match: { siteName: '北森 iTalent', adapter: 'beisen' } },
  { test: /nowcoder\.com/i, match: { siteName: '牛客网', adapter: 'nowcoder' } },
  { test: /dayee\.com/i, match: { siteName: '大易 Dayee', adapter: 'dayee' } },
  { test: /(zhaopin\.com|51job\.com)/i, match: { siteName: '智联/前程无忧', adapter: 'zhaopin' } },
  // 大厂自研：走通用引擎 + 后续定向适配
  { test: /jobs\.bytedance\.com/i, match: { siteName: '字节跳动校招', adapter: 'generic' } },
  { test: /join\.qq\.com/i, match: { siteName: '腾讯招聘', adapter: 'generic' } },
  { test: /alibaba\.com|taobao\.com/i, match: { siteName: '阿里巴巴招聘', adapter: 'generic' } },
  { test: /huawei\.com/i, match: { siteName: '华为招聘', adapter: 'generic' } },
  { test: /localhost|127\.0\.0\.1/i, match: { siteName: '本地测试页', adapter: 'generic' } },
]

export function detectSite(url: string | null | undefined): SiteMatch {
  if (!url) return { siteName: '未知页面', adapter: 'generic', confidence: 0 }
  for (const r of RULES) {
    if (r.test.test(url)) return { ...r.match, confidence: 0.95 }
  }
  return { siteName: '通用表单页', adapter: 'generic', confidence: 0.4 }
}
