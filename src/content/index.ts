import type {
  ExtMessage, FieldEl, FillResultItem, FillSummary, GroupEl, Profile, ScanRes, SectionKey,
} from '@/shared/types'
import { norm } from '@/shared/util'
import { detectSite } from '@/shared/siteDetect'
import { getActiveProfile, getSettings } from '@/shared/storage'
import { scanDocument } from './scanner'
import { enabledItemCount, getProfileValue, matchFieldsInGroup, resolveOptionValue, type FieldMatch } from './matcher'
import { applyField, highlight } from './executor'
import { renderSummary, setStatus } from './panel'
import { llmReviewFields, type ReviewField } from './llmFallback'

declare const window: Window & { __rsAutofillInjected?: boolean }
if (!window.__rsAutofillInjected) {
  window.__rsAutofillInjected = true
  chrome.runtime.onMessage.addListener((msg: ExtMessage, _sender, sendResponse) => {
    if (msg.type === 'CONTENT_SCAN') {
      const snap = scanDocument()
      const res: ScanRes = {
        ok: true,
        groups: snap.groups.map((g) => ({
          sectionKey: g.sectionKey,
          sectionHint: g.sectionHint,
          fieldCount: g.fields.length,
          hasAddButton: g.buttons.some((b) => b.kind === 'add'),
        })),
      }
      sendResponse(res)
      return
    }
    if (msg.type === 'CONTENT_FILL') {
      fillAll().then(sendResponse).catch((e) => {
        setStatus(`填写中断：${(e as Error).message}`)
      })
      return true
    }
  })
}

// ---------------- 填写编排 ----------------

function waitDomSettle(timeout = 3000, quiet = 500): Promise<void> {
  return new Promise((resolve) => {
    let timer: number | undefined
    const done = () => { observer.disconnect(); resolve() }
    const observer = new MutationObserver(() => {
      clearTimeout(timer)
      timer = window.setTimeout(done, quiet)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    timer = window.setTimeout(done, Math.max(quiet, timeout))
  })
}

async function clickAddButton(group: GroupEl): Promise<boolean> {
  const btn = group.buttons.find((b) => b.kind === 'add')
  if (!btn || !btn.el.isConnected) return false
  ;(btn.el as HTMLElement).click()
  await waitDomSettle()
  return true
}

/** 分组内匹配 → {fieldKey: 按出现顺序的匹配列表}（repeat 分区槽位切分依据） */
function occurrencesOf(group: GroupEl): Map<string, FieldMatch[]> {
  const map = new Map<string, FieldMatch[]>()
  for (const m of matchFieldsInGroup(group)) {
    const list = map.get(m.fieldKey) ?? []
    list.push(m)
    map.set(m.fieldKey, list)
  }
  return map
}

/** 字段在同 label 兄弟中的序号（0 基），用于推测它属于第几条目 */
function labelOccurrence(group: GroupEl, field: FieldEl): number {
  const target = norm(field.signals.label)
  let n = 0
  for (const f of group.fields) {
    if (f === field) return n
    if (norm(f.signals.label) === target) n++
  }
  return 0
}

function currentValueEmpty(field: FieldEl): boolean {
  const el = field.el
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return !el.value
  }
  if ((el as HTMLElement).isContentEditable) return !(el.textContent ?? '').trim()
  // 自定义组件包装层：看内部 input 值或回显文本
  const inner = el.querySelector('input')
  if (inner instanceof HTMLInputElement && inner.value) return false
  const shown = el.querySelector('[class*="selection-item"], [class*="selected"], [class*="value"]')?.textContent ?? ''
  return !shown.trim()
}

/** 开放性问题：从答案库按问题文本匹配 */
function openAnswerFor(profile: Profile, question: string): string | null {
  const nq = question.replace(/[?？。.!！\s]/g, '')
  for (const oa of profile.openAnswers) {
    const hitTag = oa.tags.some((t) => nq.includes(t.replace(/\s/g, '')))
    const hitQ = oa.question && (nq.includes(oa.question.replace(/[?？。.!！\s]/g, '').slice(0, 12)) || oa.question.includes(question.slice(0, 10)))
    if (hitTag || hitQ) return oa.answer
  }
  return null
}

async function fillAll(): Promise<FillSummary> {
  const profile = await getActiveProfile()
  if (!profile) throw new Error('还没有简历档案，请先在设置页创建')
  const settings = await getSettings()
  const site = detectSite(location.href)
  setStatus(`已识别：${site.siteName} · 正在扫描表单…`)
  const results: FillResultItem[] = []
  const touched = new Set<Element>()
  const appliedPath = new Map<Element, { path: string; score: number }>()
  let manual = 0
  let unmatched = 0

  // 填写策略组装：
  // ① 页面没有「论文/科研」分区时，论文降级合并进项目经历（反之论文绝不进项目）
  // ② 档案没有自我评价时，用专业技能清单兜底（网申几乎都有自我评价框）
  const snap0 = scanDocument()
  const P: Profile = { ...profile }
  if (!snap0.groups.some((g) => g.sectionKey === 'papers') && (profile.papers ?? []).some((p) => p.enabled !== false)) {
    const asProjects = profile.papers!.filter((p) => p.enabled !== false).map((p) => ({
      enabled: true,
      name: p.title || '论文',
      role: p.authorOrder,
      startDate: '',
      endDate: p.publishDate,
      endDateIsNow: false,
      url: p.link,
      description: [p.description, p.venue ? `发表于 ${p.venue}` : '', p.indexed ? `检索：${p.indexed}` : ''].filter(Boolean).join('；'),
      contribution: '',
      achievements: '',
      techStack: [],
    }))
    P.projects = [...(profile.projects ?? []).filter((p) => p.enabled !== false), ...asProjects]
  }
  if (!profile.selfEvaluation && (profile.itSkills ?? []).length > 0) {
    P.selfEvaluation = `专业技能：${profile.itSkills.map((s) => s.skill).join('、')}`
  }

  async function fillOne(
    field: FieldEl, path: string, value: string, confidence: number, reason: string,
    sectionKey: SectionKey, via: FillResultItem['via'] = 'rule',
  ): Promise<void> {
    touched.add(field.el)
    appliedPath.set(field.el, { path, score: confidence })
    const item: FillResultItem = {
      fieldRef: field.ref, sectionKey, profilePath: path, label: field.signals.label,
      value, confidence, via, reason, status: 'filled',
    }
    const optionCheck = resolveOptionValue(field, value)
    if (!optionCheck.matched) {
      item.reason = `下拉/单选无匹配选项：${(field.signals.options ?? []).slice(0, 6).join('/')}；已填原值待确认`
    }
    const err = await applyField(field, optionCheck.value)
    if (err) {
      // [待确认] 前缀 = 值大概率已写入但需人工确认（读回不一致/搜索无匹配/至今需勾选），标橙不算失败
      const soft = err.startsWith('[待确认]')
      item.error = soft ? err.replace(/^\[待确认\]\s*/, '') : err
      item.status = soft ? 'review' : 'failed'
      highlight(field.el, item.status)
    } else {
      item.status = confidence >= 95 && optionCheck.matched ? 'filled' : 'review'
      highlight(field.el, item.status)
    }
    results.push(item)
  }

  // 简单分区：basic / intention / selfEvaluation / itSkills
  const fillSimple = async (group: GroupEl) => {
    for (const m of matchFieldsInGroup(group)) {
      const path = `${m.sectionKey}.${m.fieldKey}`
      const { value, ok } = getProfileValue(P, path)
      if (!ok || !value) { unmatched++; continue }
      await fillOne(m.field, path, value, m.confidence, m.reason, m.sectionKey)
    }
  }

  // repeat 分区：按条目序填，槽位不够先点「添加」
  const fillRepeat = async (sectionKey: GroupEl['sectionKey']) => {
    const items = enabledItemCount(P, sectionKey)
    if (items === 0) return
    let snap = scanDocument()
    let group = snap.groups.find((g) => g.sectionKey === sectionKey)
    if (!group) return
    let occ = occurrencesOf(group)
    // 初始槽位数：分区默认为空（无字段）时为 0，首条即触发「点添加」
    let slots = Math.max(0, ...Array.from(occ.values()).map((v) => v.length))

    for (let k = 0; k < items; k++) {
      if (k >= slots) {
        setStatus(`正在点击「添加」创建第 ${k + 1} 条…`)
        const clicked = await clickAddButton(group)
        if (!clicked) { unmatched += 1; break }
        snap = scanDocument()
        group = snap.groups.find((g) => g.sectionKey === sectionKey) ?? group
        occ = occurrencesOf(group)
        slots = Math.max(slots, ...Array.from(occ.values()).map((v) => v.length))
        if (k >= slots) { unmatched += 1; break } // 点了添加槽位仍没出现，放弃该分区
      }
      setStatus(`正在填写${group.sectionHint || sectionKey} 第 ${k + 1}/${items} 条…`)
      for (const [fieldKey, list] of occ) {
        const m = list[k]
        if (!m) continue
        const path = `${m.sectionKey}[${k}].${fieldKey}`
        const { value, ok } = getProfileValue(P, path)
        if (!ok || !value) continue
        await fillOne(m.field, path, value, m.confidence, m.reason, m.sectionKey)
      }
    }
  }

  for (const group of snap0.groups) {
    manual += group.fields.filter((f) => f.control === 'upload').length

    if (group.sectionKey === 'openQuestions') {
      for (const f of group.fields) {
        const q = f.signals.label || f.signals.placeholder
        const answer = q ? openAnswerFor(P, q) : null
        if (answer) {
          await fillOne(f, 'openAnswers.answer', answer, 0.7, '开放题答案库命中', 'openQuestions')
        } else {
          highlight(f.el, 'skipped')
        }
      }
      continue
    }
    if (group.kind === 'repeat') {
      await fillRepeat(group.sectionKey)
    } else {
      await fillSimple(group)
    }
  }

  // -------- LLM 全量复审：规则层结果 + 未匹配字段整体交给 LLM 二次匹配/纠错 --------
  let llmNote = ''
  if (settings.privacyMode !== 'off' && settings.apiBaseUrl && settings.apiKey && settings.model) {
    const ctxs: ReviewField[] = []
    for (const group of scanDocument().groups) {
      if (group.sectionKey === 'openQuestions') continue
      for (const f of group.fields) {
        if (f.control === 'upload') continue
        const handled = touched.has(f.el)
        if (!handled && !currentValueEmpty(f)) continue // 页面已有值且我们没动过：尊重现状
        const k = labelOccurrence(group, f)
        ctxs.push({
          field: f,
          sectionKey: group.sectionKey,
          slotHint: group.kind === 'repeat' ? `${group.sectionHint} 第${k + 1}条` : group.sectionHint,
          rule: handled ? (appliedPath.get(f.el) ?? { path: '', score: 0 }) : undefined,
        })
        if (ctxs.length >= 60) break
      }
      if (ctxs.length >= 60) break
    }
    if (ctxs.length > 0) {
      setStatus(`LLM 复审 ${ctxs.length} 个字段（规则结果 + 未匹配项）…`)
      const { fills, fixes, message } = await llmReviewFields(ctxs, P, settings)
      for (const h of fills) {
        if (touched.has(h.ctx.field.el)) continue // 补填只作用于规则没处理过的字段
        await fillOne(h.ctx.field, h.path, h.value, h.confidence, `LLM 补填：${h.why}`, h.ctx.sectionKey, 'llm')
      }
      let fixedCount = 0
      for (const h of fixes) {
        if (h.confidence < 0.75) continue
        const cur = appliedPath.get(h.ctx.field.el)
        if (cur && cur.path === h.path) continue // 与规则一致，无需纠正
        await fillOne(h.ctx.field, h.path, h.value, h.confidence, `LLM 纠正：${h.why}`, h.ctx.sectionKey, 'llm')
        fixedCount++
      }
      llmNote = message + (fixedCount > 0 ? `，已纠正 ${fixedCount} 项` : '')
    }
  }

  const summary: FillSummary = {
    totalFields: results.length,
    filled: results.filter((r) => r.status === 'filled').length,
    review: results.filter((r) => r.status === 'review').length,
    failed: results.filter((r) => r.status === 'failed').length,
    unmatched,
    manual,
    items: results,
    siteName: llmNote ? `${site.siteName}（${llmNote}）` : site.siteName,
    at: Date.now(),
  }
  renderSummary(summary)
  return summary
}

export {}
