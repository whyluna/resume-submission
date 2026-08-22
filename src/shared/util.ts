/** 归一化：全角→半角、去空白/冒号/星号、统一小写。匹配前所有文本都先过这里。 */
export function norm(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/[:：*＊\s、，,（）()\/]/g, '')
    .toLowerCase()
    .trim()
}

/** CSS 路径（nth-of-type 链），配合同路径 index 构成 StableRef */
export function cssPath(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  let anchoredById = false
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const parent: Element | null = cur.parentElement
    if (!parent) break
    let selector = cur.tagName.toLowerCase()
    if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) {
      parts.unshift(`#${cur.id}`)
      anchoredById = true
      break
    }
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName)
    if (sameTag.length > 1) selector += `:nth-of-type(${sameTag.indexOf(cur) + 1})`
    parts.unshift(selector)
    cur = parent
  }
  return (anchoredById ? '' : 'body>') + parts.join('>')
}

/** djb2 哈希，用于字段 signature */
export function hashSig(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 选项匹配：优先归一化全等，其次包含，返回最匹配的 option value；找不到返回 null */
export function matchOption(options: Array<{ value: string; text: string }>, value: string): string | null {
  const nv = norm(value)
  if (!nv) return null
  let best: { value: string; score: number } | null = null
  for (const o of options) {
    const no = norm(o.text)
    if (!no) continue
    let score = 0
    if (no === nv || norm(o.value) === nv) score = 100
    else if (no.includes(nv) || nv.includes(no)) score = 70
    if (score > (best?.score ?? 0)) best = { value: o.value, score }
  }
  return best && best.score >= 70 ? best.value : null
}

/** 中文身份字段枚举值与页面选项的同义匹配（性别/是否/学历等） */
const SYNONYM_GROUPS: string[][] = [
  ['男', 'male', 'm'],
  ['女', 'female', 'f'],
  ['是', 'yes', 'y', '有'],
  ['否', 'no', 'n', '无'],
  ['已婚', 'married'],
  ['未婚', 'unmarried', '单身'],
  ['中共党员', '党员'],
  ['共青团员', '团员'],
  ['群众', '无党派'],
  // 学历/学位混称：学硕专硕→硕士、本科↔学士、博士研究生↔博士（下拉/单选匹配用）
  ['硕士', '硕士研究生', '研究生', '学硕', '专硕', '学术型硕士', '专业型硕士', 'master'],
  ['博士', '博士研究生', 'phd'],
  ['学士', '本科', 'bachelor'],
  ['专科', '大专', '大专专科'],
]

export function isSynonym(a: string, b: string): boolean {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  if (na === nb) return true
  return SYNONYM_GROUPS.some((g) => {
    const hit = (x: string) => g.some((s) => norm(s) === x)
    return hit(na) && hit(nb)
  })
}
