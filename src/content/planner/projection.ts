import type { ProjectedValue, TransformId } from '@/shared/semanticPlan'
import { normalizeDateValue } from '@/shared/dateValues'

export interface DateRangeSource {
  startDate: string
  endDate: string
  endDateIsNow: boolean
}

function first(values: string[]): string {
  return values.map((value) => value.trim()).find(Boolean) ?? ''
}

function splitDate(value: string): { year: string; month: string; day: string } {
  const normalized = normalizeDateValue(value).value
  const match = normalized.match(/(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/)
  return {
    year: match?.[1] ?? '',
    month: match?.[2]?.padStart(2, '0') ?? '',
    day: match?.[3]?.padStart(2, '0') ?? '',
  }
}

export function projectDateRange(source: DateRangeSource): ProjectedValue {
  const start = splitDate(source.startDate)
  const end = splitDate(source.endDate)
  const parts: Record<string, string> = {
    'start-year': start.year,
    'start-month': start.month,
    'end-year': source.endDateIsNow ? '' : end.year,
    'end-month': source.endDateIsNow ? '' : end.month,
    'current-toggle': source.endDateIsNow ? '是' : '否',
  }
  if (start.day) parts['start-day'] = start.day
  if (end.day) parts['end-day'] = source.endDateIsNow ? '' : end.day
  return {
    kind: 'parts',
    parts,
  }
}

export function projectDateSingle(value: string): ProjectedValue {
  const date = splitDate(value)
  if (!date.year) return { kind: 'missing', reason: '日期值无法规范化' }
  return {
    kind: 'parts',
    parts: { year: date.year, month: date.month, day: date.day },
  }
}

function splitDateRange(values: string[]): [string, string] {
  if (values.length > 1) return [values[0], values[1]]

  const raw = first(values)
  const currentMatch = raw.match(/(至今|现在|在读)\s*$/)
  if (currentMatch?.index !== undefined) {
    const start = raw
      .slice(0, currentMatch.index)
      .replace(/\s*(?:~|～|到|至|—|–)\s*$/, '')
      .trim()
    return [start, currentMatch[1]]
  }

  const parts = raw.split(/\s*(?:~|～|到|至|—|–)\s*|\s+-\s+/, 2)
  return [parts[0] ?? '', parts[1] ?? '']
}

export function projectValues(transform: TransformId, values: string[]): ProjectedValue {
  const usable = values.map((value) => value.trim()).filter(Boolean)
  if (usable.length === 0) return { kind: 'missing', reason: '档案中没有可用值' }
  if (transform === 'aggregate-text') return { kind: 'scalar', value: usable.join('\n') }
  if (transform === 'derive-boolean') return { kind: 'scalar', value: usable.length > 0 ? '是' : '否' }
  if (transform === 'join-list') return { kind: 'scalar', value: usable.join('、') }
  if (transform === 'date-range') return { kind: 'scalar', value: usable.join(' ~ ') }
  if (transform === 'split-date-single') return projectDateSingle(first(usable))
  if (transform === 'split-date-parts') {
    const [startRaw, endRaw] = splitDateRange(usable)
    const endIsNow = /至今|现在|在读/.test(endRaw)
    return projectDateRange({ startDate: startRaw, endDate: endRaw, endDateIsNow: endIsNow })
  }
  return { kind: 'scalar', value: first(usable) }
}
