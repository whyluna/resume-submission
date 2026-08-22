import type {
  FieldEl, LlmMatchRes, Profile, SectionKey, Settings,
} from '@/shared/types'
import { SECTIONS } from '@/shared/profileSchema'
import { getProfileValue } from './matcher'

/** 交给 LLM 复审的字段：规则结果（有则带上）或未匹配项 */
export interface ReviewField {
  field: FieldEl
  sectionKey: SectionKey
  slotHint: string // 如 "教育经历 第2条"
  /** 规则引擎已填的映射；undefined = 规则未处理该字段 */
  rule?: { path: string; score: number }
}

export interface LlmMatchHit {
  ctx: ReviewField
  path: string
  value: string
  confidence: number
  why: string
}

/** path 是否敏感（basic.idNumber / familyMembers 的姓名电话等）——任何模式都不外发明文 */
function pathIsSensitive(path: string): boolean {
  const m = path.match(/^(\w+?)(?:\[\d+\])?\.(\w+)$/)
  if (!m) return false
  const [, section, fieldKey] = m
  if (section === 'familyMembers') return ['name', 'phone', 'age'].includes(fieldKey)
  for (const def of SECTIONS) {
    if (def.key !== section) continue
    return !!def.fields.find((f) => f.k === fieldKey)?.sensitive
  }
  return false
}

/**
 * 简历侧摘要行："path: 中文含义=当前值"。
 * labels-only 模式不带值；with-values 带值但敏感字段掩码（🔒 元数据标记）。
 */
function buildProfileLines(profile: Profile, withValues: boolean): string[] {
  const lines: string[] = []
  const push = (path: string, label: string, sensitive: boolean, v: unknown) => {
    if (!withValues) { lines.push(`${path}: ${label}`); return }
    const val = Array.isArray(v) ? v.join('、') : String(v ?? '').trim()
    if (!val) return
    lines.push(sensitive ? `${path}: ${label}=***` : `${path}: ${label}=${val}`)
  }
  const store = profile as unknown as Record<string, unknown>
  for (const def of SECTIONS) {
    if (def.repeat) {
      const arr = store[def.key] as Record<string, unknown>[] | undefined
      arr?.forEach((it, i) => {
        if (it.enabled === false) return
        for (const f of def.fields) push(`${def.key}[${i}].${f.k}`, f.label, !!f.sensitive, it[f.k])
      })
    } else {
      const obj = store[def.key] as Record<string, unknown> | undefined
      if (obj) for (const f of def.fields) push(`${def.key}.${f.k}`, f.label, !!f.sensitive, obj[f.k])
    }
  }
  return lines
}

/**
 * LLM 全量复审：规则层结果 + 未匹配字段整体发给任务B2，
 * 返回本地校验过的补填（fills，仅针对未处理字段）与纠正（fixes，针对已填字段）。
 * path 必须能本地取到值才收（防幻觉）。
 */
export async function llmReviewFields(
  ctxs: ReviewField[], profile: Profile, settings: Settings,
): Promise<{ fills: LlmMatchHit[]; fixes: LlmMatchHit[]; message: string }> {
  if (settings.privacyMode === 'off' || ctxs.length === 0) return { fills: [], fixes: [], message: '' }
  if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    return { fills: [], fixes: [], message: '未配置 API，跳过 LLM 复审' }
  }
  const withValues = settings.privacyMode === 'with-values'
  const fields = ctxs.slice(0, 60).map((c, i) => {
    const rulePath = c.rule?.path
    let rule: { path: string; score: number; value?: string } | null = null
    if (rulePath) {
      const { value } = getProfileValue(profile, rulePath)
      rule = {
        path: rulePath,
        score: Math.max(0, Math.min(1, Math.round((c.rule?.score ?? 0)) / 100)),
        value: rulePath && pathIsSensitive(rulePath) ? '***' : (withValues ? value : undefined),
      }
    }
    return {
      i,
      label: c.field.signals.label,
      name: c.field.signals.name,
      id: c.field.signals.id,
      placeholder: c.field.signals.placeholder,
      section: c.slotHint ? `${c.slotHint}（${c.sectionKey}）` : c.sectionKey,
      options: c.field.signals.options?.slice(0, 12),
      rule,
    }
  })
  const profileLines = buildProfileLines(profile, withValues)
  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'LLM_MATCH',
      fields,
      profileLines,
    })) as LlmMatchRes
    if (!res.ok || !res.plan) return { fills: [], fixes: [], message: res.message }
    const fills: LlmMatchHit[] = []
    const fixes: LlmMatchHit[] = []
    for (const p of res.plan) {
      const ctx = ctxs[p.i]
      if (!ctx) continue
      const { value, ok } = getProfileValue(profile, p.path)
      if (!ok || !value) continue // 防 LLM 幻觉：路径必须真实可取值
      const hit: LlmMatchHit = { ctx, path: p.path, value, confidence: Math.min(p.c, 0.9), why: p.why }
      if (p.op === 'fix') fixes.push(hit)
      else fills.push(hit)
    }
    return { fills, fixes, message: res.message }
  } catch (e) {
    return { fills: [], fixes: [], message: `LLM 复审请求失败：${(e as Error).message}` }
  }
}
