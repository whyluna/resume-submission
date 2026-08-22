import type { Profile } from './types'

export interface CanonicalDateResult {
  value: string
  ongoing: boolean
  valid: boolean
}

const ONGOING_RE = /^(?:至今|现在|在读|进行中|仍在职)$/
const RANGE_SECTIONS = ['educations', 'experiences', 'projects', 'studentWork'] as const
const SINGLE_DATE_FIELDS: ReadonlyArray<[keyof Profile, string]> = [
  ['papers', 'publishDate'],
  ['competitions', 'date'],
  ['awards', 'date'],
  ['languages', 'date'],
  ['certificates', 'date'],
]

/**
 * 将简历来源中的常见日期写法归一化为 YYYY、YYYY-MM 或 YYYY-MM-DD。
 * 无法可靠识别的旧值原样保留并标记 invalid，避免迁移时静默丢数据。
 */
export function normalizeDateValue(input: unknown): CanonicalDateResult {
  const original = String(input ?? '').trim()
  const raw = original
    .replace(/\s*[（(]\s*\d+\s*岁\s*[）)]\s*$/, '')
    .replace(/\s+\d+\s*岁\s*$/, '')
    .trim()
  if (!raw) return { value: '', ongoing: false, valid: true }
  if (ONGOING_RE.test(raw)) return { value: '', ongoing: true, valid: true }

  const normalizedDigits = raw.normalize('NFKC')
  const dayMatch = normalizedDigits.match(/^(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*日?$/)
  const monthMatch = dayMatch ? null : normalizedDigits.match(/^(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*月?$/)
  const yearMatch = dayMatch || monthMatch ? null : normalizedDigits.match(/^(\d{4})\s*年?$/)
  const match = dayMatch ?? monthMatch ?? yearMatch
  if (!match) return { value: original, ongoing: false, valid: false }

  const year = match[1]
  const month = match[2] ? Number(match[2]) : undefined
  const day = match[3] ? Number(match[3]) : undefined
  if ((month !== undefined && (month < 1 || month > 12)) || (day !== undefined && (day < 1 || day > 31))) {
    return { value: original, ongoing: false, valid: false }
  }
  if (month !== undefined && day !== undefined) {
    const candidate = new Date(Date.UTC(Number(year), month - 1, day))
    if (candidate.getUTCFullYear() !== Number(year) || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
      return { value: original, ongoing: false, valid: false }
    }
  }
  const value = [year, month?.toString().padStart(2, '0'), day?.toString().padStart(2, '0')]
    .filter(Boolean)
    .join('-')
  return { value, ongoing: false, valid: true }
}

function splitLegacyRange(raw: string): [string, string] | null {
  const currentMatch = raw.match(/(至今|现在|在读|进行中|仍在职)\s*$/)
  if (currentMatch?.index !== undefined) {
    const start = raw.slice(0, currentMatch.index).replace(/\s*(?:~|～|到|至|—|–)\s*$/, '').trim()
    return [start, currentMatch[1]]
  }
  const parts = raw.split(/\s*(?:~|～|到|至|—|–)\s*|\s+-\s+/, 2)
  return parts.length === 2 ? [parts[0], parts[1]] : null
}

function normalizeRangeItem(item: Record<string, unknown>): void {
  let startRaw = String(item.startDate ?? '').trim()
  let endRaw = String(item.endDate ?? '').trim()
  const embedded = splitLegacyRange(startRaw) ?? (!startRaw ? splitLegacyRange(endRaw) : null)
  if (embedded) [startRaw, endRaw] = embedded

  const start = normalizeDateValue(startRaw)
  const end = normalizeDateValue(endRaw)
  const explicitOngoing = item.endDateIsNow === true || String(item.endDateIsNow).toLowerCase() === 'true'
  item.startDate = start.value
  item.endDateIsNow = explicitOngoing || end.ongoing
  item.endDate = item.endDateIsNow ? '' : end.value
}

/** Storage/import boundary migration. Mutates and returns the profile for compatibility. */
export function normalizeProfileDates<T extends Partial<Profile>>(profile: T): T {
  if (profile.basic) profile.basic.birthDate = normalizeDateValue(profile.basic.birthDate).value
  if (profile.intention) {
    const available = normalizeDateValue(profile.intention.availableDate)
    if (available.valid) profile.intention.availableDate = available.value
  }

  const store = profile as Record<string, unknown>
  for (const section of RANGE_SECTIONS) {
    const items = store[section]
    if (!Array.isArray(items)) continue
    for (const item of items) if (item && typeof item === 'object') normalizeRangeItem(item as Record<string, unknown>)
  }
  for (const [section, field] of SINGLE_DATE_FIELDS) {
    const items = store[section as string]
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      row[field] = normalizeDateValue(row[field]).value
    }
  }
  return profile
}
