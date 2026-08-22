import type { FieldEl, GroupEl, Profile, SectionKey } from '@/shared/types'
import { isSynonym, norm } from '@/shared/util'
import { SECTION_ITEM_ARRAY } from '@/shared/profileSchema'
import { ALIASES } from './aliases'

export interface FieldMatch {
  fieldKey: string // 档案字段名，如 school / name
  sectionKey: SectionKey // 值查找用的分区（可能与页面分区不同）
  field: FieldEl
  confidence: number
  reason: string
}

/** 单个别名与字段信号的加权得分。≥95 视为高置信，≥60 可填但标橙复核。 */
function scoreAlias(alias: string, f: FieldEl): { score: number; why: string } {
  const s = f.signals
  let score = 0
  let why = ''
  const label = norm(s.label)
  if (label) {
    if (label === alias) { if (score < 100) { score = 100; why = 'label 全等' } }
    else if (label.includes(alias) || alias.includes(label)) { if (score < 60) { score = 60; why = 'label 包含' } }
  }
  for (const t of s.labelNear.map(norm)) {
    if (!t || t === label) continue
    if (t === alias) { if (score < 80) { score = 80; why = '邻近文本全等' } }
    else if (t.includes(alias)) { if (score < 50) { score = 50; why = '邻近文本包含' } }
  }
  for (const src of [s.name, s.id, s.placeholder, s.ariaLabel, s.title].map(norm)) {
    if (!src) continue
    if (src === alias) { if (score < 45) { score = 45; why = '属性全等' } }
    else if (src.includes(alias) && alias.length >= 2) { if (score < 30) { score = 30; why = '属性包含' } }
  }
  return { score, why }
}

/** 在一个分组内为每个字段找最佳档案字段。repeat 分区后续按出现次数分槽位。 */
export function matchFieldsInGroup(group: GroupEl): FieldMatch[] {
  const out: FieldMatch[] = []
  for (const field of group.fields) {
    if (field.control === 'upload') continue
    let best: FieldMatch | null = null
    const sections: SectionKey[] = group.sectionKey !== 'unknown' && ALIASES[group.sectionKey]
      ? [group.sectionKey]
      : (Object.keys(ALIASES) as SectionKey[])
    for (const section of sections) {
      for (const [fieldKey, aliasList] of Object.entries(ALIASES[section] ?? {})) {
        // 复选框承载不了日期值：「至今」勾选框的邻近文本常含「就读时间/起止时间」，
        // 若放行会劫持 __range 匹配、虚增槽位数（把勾选框当成第 2 条目）
        if (field.control === 'checkbox' && ['__range', 'startDate', 'endDate', 'date', 'publishDate'].includes(fieldKey)) continue
        for (const aliasRaw of aliasList) {
          const alias = norm(aliasRaw)
          if (!alias) continue
          const { score, why } = scoreAlias(alias, field)
          if (score < 40) continue
          // 分区交叉验证：别名属于当前分区加分，跨分区惩罚
          let adjusted = score
          const sameSection = section === group.sectionKey
          if (group.sectionKey !== 'unknown') adjusted += sameSection ? 15 : -35
          else adjusted += 5 // 未知分区里的裸字段（"姓名"），轻微软化
          if (!best || adjusted > best.confidence) {
            best = { fieldKey, sectionKey: section, field, confidence: adjusted, reason: `${why}（${aliasRaw}）` }
          }
        }
      }
    }
    if (best) out.push(best)
  }
  return out
}

// ---------------- 档案取值 ----------------

function joinList(v: unknown): string {
  if (Array.isArray(v)) return v.filter(Boolean).join('、')
  if (v === true) return '是'
  if (v === false) return '否'
  return v == null ? '' : String(v)
}

/** path 形如 basic.name / educations[1].school / selfEvaluation.selfEvaluation */
export function getProfileValue(profile: Profile, path: string): { value: string; ok: boolean } {
  const m = path.match(/^(\w+?)(?:\[(\d+)\])?\.(\w+)$/)
  if (!m) return { value: '', ok: false }
  const [, section, idxStr, fieldKey] = m
  const idx = idxStr ? Number(idxStr) : -1
  if (section === 'basic' && idx < 0) {
    const b = profile.basic as unknown as Record<string, unknown>
    const v = b[fieldKey]
    return { value: joinList(v), ok: v != null && v !== '' }
  }
  if (section === 'intention' && idx < 0) {
    const it = profile.intention as unknown as Record<string, unknown>
    if (fieldKey === 'salaryMin') {
      const v = it.salaryMin && it.salaryMax ? `${it.salaryMin}-${it.salaryMax}` : String(it.salaryMin ?? '')
      return { value: v, ok: v !== '' }
    }
    return { value: joinList(it[fieldKey]), ok: it[fieldKey] != null && it[fieldKey] !== '' }
  }
  if (section === 'selfEvaluation' && idx < 0) {
    // 防御历史脏数据：selfEvaluation 可能被旧编辑器存成对象
    const se = profile.selfEvaluation as unknown
    const val = typeof se === 'string' ? se : String((se as Record<string, unknown>)?.selfEvaluation ?? '')
    return { value: val, ok: val !== '' }
  }
  const arrKey = SECTION_ITEM_ARRAY[section as SectionKey]
  const arr = arrKey ? (profile as unknown as Record<string, unknown>)[arrKey] : null
  if (!Array.isArray(arr) || idx < 0) return { value: '', ok: false }
  const item = arr[idx] as Record<string, unknown> | undefined
  if (!item) return { value: '', ok: false }
  // 区间日期伪字段：起止时间合并为 "start ~ end"，end 为至今时原样保留
  if (fieldKey === '__range') {
    const s = joinList(item.startDate)
    const e = item.endDateIsNow ? '至今' : joinList(item.endDate)
    if (!s && !e) return { value: '', ok: false }
    return { value: [s, e].filter(Boolean).join(' ~ '), ok: true }
  }
  if (fieldKey === 'endDate' && item.endDateIsNow) return { value: '至今', ok: true }
  const v = item[fieldKey]
  return { value: joinList(v), ok: v != null && v !== '' }
}

/** repeat 分区的可用条目数（enabled） */
export function enabledItemCount(profile: Profile, section: SectionKey): number {
  const arrKey = SECTION_ITEM_ARRAY[section]
  if (!arrKey) return 0
  const arr = (profile as unknown as Record<string, unknown>)[arrKey]
  if (!Array.isArray(arr)) return 0
  return arr.filter((it) => !it || (it as Record<string, unknown>).enabled !== false).length
}

/** select/radio 值兼容性预检：把档案值换算成页面可接受的选项文本 */
export function resolveOptionValue(field: FieldEl, value: string): { value: string; matched: boolean } {
  const options = field.signals.options ?? []
  if (options.length === 0) return { value, matched: true }
  const nv = norm(value)
  const direct = options.find((o) => norm(o) === nv)
  if (direct) return { value: direct, matched: true }
  const syn = options.find((o) => isSynonym(o, value))
  if (syn) return { value: syn, matched: true }
  const incl = options.find((o) => norm(o).includes(nv) || nv.includes(norm(o)))
  if (incl) return { value: incl, matched: true }
  return { value, matched: false }
}
