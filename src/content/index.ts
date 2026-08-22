import type {
  ExtMessage, FieldEl, FillResultItem, FillSummary, GroupEl, OneShotSemanticResponse, Profile, ScanRes, SectionKey, SemanticPlannerResponse,
} from '@/shared/types'
import type { FormPageIR } from '@/shared/formIr'
import { norm } from '@/shared/util'
import { detectSite } from '@/shared/siteDetect'
import { getActiveProfile, getSettings } from '@/shared/storage'
import { scanDocument } from './scanner'
import { enabledItemCount, getProfileValue, matchFieldsInGroup, resolveOptionValue, type FieldMatch } from './matcher'
import { applyField, highlight } from './executor'
import { renderSummary, setStatus } from './panel'
import { llmReviewFields, type ReviewField } from './llmFallback'
import { discoverPageModel } from './discover/pageModel'
import { executeSemanticPlan } from './executorV2/executePlan'
import { prepareRepeatEntries } from './adapters/repeatEntries'
import { resolveElement } from './executorV2/dom'
import { projectProfileForPage } from '@/shared/profileProjection'
import { runSemanticOnce } from './agent/runSemanticOnce'

declare const window: Window & { __rsAutofillInjected?: boolean }
if (!window.__rsAutofillInjected) {
  window.__rsAutofillInjected = true
  chrome.runtime.onMessage.addListener((msg: ExtMessage, _sender, sendResponse) => {
    if (msg.type === 'CONTENT_SCAN') {
      const snap = scanDocument()
      const model = discoverPageModel(document, location.href)
      const res: ScanRes = {
        ok: true,
        groups: snap.groups.map((g) => ({
          sectionKey: g.sectionKey,
          sectionHint: g.sectionHint,
          fieldCount: g.fields.length,
          hasAddButton: g.buttons.some((b) => b.kind === 'add'),
        })),
        v2: {
          adapterId: model.adapterId,
          maturity: model.adapterMaturity,
          totalFields: model.sections.reduce((total, section) => total + section.fields.length
            + section.entries.reduce((sum, entry) => sum + entry.fields.length, 0), 0),
          forbiddenActions: [...model.globalActions, ...model.sections.flatMap((section) => section.actions)]
            .filter((action) => action.safety === 'forbidden').length,
          sections: model.sections.map((section) => ({
            title: section.title,
            entryCount: section.entries.length,
            fieldCount: section.fields.length + section.entries.reduce((sum, entry) => sum + entry.fields.length, 0),
          })),
        },
      }
      sendResponse(res)
      return
    }
    if (msg.type === 'CONTENT_FILL') {
      fillCurrent().then(sendResponse).catch((e) => {
        const message = (e as Error).message
        setStatus(`填写中断：${message}`)
        sendResponse(failedSummary(message, '混合语义填写'))
      })
      return true
    }
    if (msg.type === 'CONTENT_FILL_V2') {
      fillAllV2().then(sendResponse).catch((e) => {
        const message = (e as Error).message
        setStatus(`V2 填写中断：${message}`)
        sendResponse({ total: 1, verified: 0, manual: 0, failed: 1, results: [], error: message })
      })
      return true
    }
  })
}

async function fillCurrent(): Promise<FillSummary> {
  const settings = await getSettings()
  if (settings.agentMode) return fillWithAgent()
  const adapterId = discoverPageModel(document, location.href).adapterId
  const useV2 = adapterId === 'moka' || adapterId === 'dayee-wt' || adapterId === 'kuma'
  return useV2 ? fillPlatformV2(adapterId) : fillAll()
}

function failedSummary(message: string, siteName: string): FillSummary {
  return {
    totalFields: 1, filled: 0, review: 0, failed: 1, unmatched: 0, manual: 0,
    items: [{
      fieldRef: { cssPath: '', index: 0 }, sectionKey: 'unknown', profilePath: '', label: '执行流程', value: '',
      confidence: 0, via: 'rule', reason: message, status: 'failed', error: message,
    }],
    siteName,
    at: Date.now(),
  }
}

async function fillAllV2() {
  const profile = await getActiveProfile()
  if (!profile) throw new Error('还没有简历档案，请先在设置页创建')
  setStatus('V2：正在构建页面模型并进行全分区规划…')
  let model = discoverPageModel(document, location.href)
  if (model.adapterId === 'moka') model = (await prepareRepeatEntries(model, profile, document)).model
  const planned = await requestPagePlan(model)
  if (!planned.ok) throw new Error(planned.error || '语义规划失败')
  setStatus(`V2：执行 ${planned.plan.length} 个计划项，只统计读回成功项…`)
  const report = await executeSemanticPlan(model, profile, planned.plan, document)
  setStatus(`V2：已验证 ${report.verified}，人工 ${report.manual}，失败 ${report.failed}；页面尚未保存/提交`)
  return { ...report, plannerMessages: planned.messages, rejectedPlans: planned.rejected }
}

async function requestPagePlan(model: ReturnType<typeof discoverPageModel>): Promise<SemanticPlannerResponse> {
  const message = { type: 'LLM_PLAN_PAGE', model } satisfies ExtMessage
  let response = await chrome.runtime.sendMessage(message) as SemanticPlannerResponse | undefined
  if (!response) {
    await new Promise((resolve) => setTimeout(resolve, 80))
    response = await chrome.runtime.sendMessage(message) as SemanticPlannerResponse | undefined
  }
  return response ?? { ok: false, plan: [], rejected: 0, messages: [], error: '规划后台连续两次未响应，请刷新页面后重试' }
}

async function requestOneShotReview(ir: FormPageIR): Promise<OneShotSemanticResponse> {
  const message = { type: 'LLM_REVIEW_ONESHOT', ir } satisfies ExtMessage
  const response = await chrome.runtime.sendMessage(message) as OneShotSemanticResponse | undefined
  return response ?? {
    ok: false, plan: [], modelRequestCount: 0, modelDecisions: 0, ruleDecisions: 0, manualDecisions: 0,
    rejected: [], messages: [], latencyMs: 0, sources: {}, error: '单次语义复审后台未响应，请刷新扩展后重试',
  }
}

async function fillWithAgent(): Promise<FillSummary> {
  const [stored, settings] = await Promise.all([getActiveProfile(), getSettings()])
  if (!stored) throw new Error('还没有简历档案，请先在设置页创建')
  const initialModel = discoverPageModel(document, location.href)
  const fieldCount = initialModel.sections.reduce((total, section) => total + section.fields.length
    + section.entries.reduce((sum, entry) => sum + entry.fields.length, 0), 0)
  if (fieldCount === 0) throw new Error('混合语义链路未观察到可填写字段；请先运行“仅扫描表单”查看诊断')
  const profile = projectProfileForPage(stored, initialModel)
  setStatus(`混合语义 Agent：已观察 ${initialModel.sections.length} 个分区、${fieldCount} 个字段…`)
  const report = await runSemanticOnce(initialModel, profile, settings.privacyMode, requestOneShotReview, document, setStatus)
  const finalModel = discoverPageModel(document, location.href)
  const fields = new Map([...report.prepared.model.sections, ...finalModel.sections].flatMap((section) => [
    ...section.fields,
    ...section.entries.flatMap((entry) => entry.fields),
  ]).map((field) => [field.id, field]))
  const sections = report.prepared.model.sections
  const irFieldById = new Map(report.ir.fields.map((field) => [field.fieldId, field]))
  const resultByField = new Map(report.execution.results.map((result) => [result.fieldId, result]))
  const items: FillResultItem[] = report.plan.map((plan) => {
    const fieldId = plan.fieldId
    const field = fields.get(fieldId)
    const irField = irFieldById.get(fieldId)
    const result = resultByField.get(fieldId)
    const root = field ? resolveElement(field.control.root, document) : null
    const status = result?.verified ? 'filled' : plan.decision === 'skip' ? 'skipped' : result?.state === 'manual' ? 'review' : 'failed'
    if (root) highlight(root, status === 'filled' ? 'filled' : status === 'review' ? 'review' : 'failed')
    const section = sections.find((candidate) => candidate.fields.some((item) => item.id === fieldId)
      || candidate.entries.some((entry) => entry.fields.some((item) => item.id === fieldId)))
    const source = report.sources[fieldId] ?? 'local-safety'
    const sourceText = source === 'llm-review' ? 'LLM 全量复审' : source === 'rule-candidate' ? '规则候选' : '本地安全决策'
    const stage = result
      ? `映射=${result.mapped ? '是' : '否'}，写入=${result.written ? '是' : '否'}，提交控件=${result.committed ? '是' : '否'}，最终读回=${result.verified ? '一致' : '未通过'}`
      : '没有执行结果'
    return {
      fieldRef: { cssPath: field?.control.root.cssPath ?? '', index: field?.control.root.index ?? 0 },
      sectionKey: irField?.entryRoute?.profileSection ?? section?.semanticCandidates[0] ?? 'unknown',
      profilePath: plan.profilePaths.join(','),
      label: irField?.labels[0] || field?.signals.label || field?.signals.placeholder || '未命名字段',
      value: '', confidence: plan.confidence,
      via: source === 'llm-review' ? 'llm' : 'rule',
      reason: `${sourceText}：${plan.decision} / ${plan.transform} / ${plan.reason || '无说明'}；本地执行：${stage}${result?.message ? `；${result.message}` : ''}`,
      status,
      ...(status === 'failed' ? { error: result?.message || '没有执行结果' } : {}),
    }
  })
  const filled = items.filter((item) => item.status === 'filled').length
  const review = items.filter((item) => item.status === 'review').length
  const failed = items.filter((item) => item.status === 'failed').length
  const adapterName = initialModel.adapterId === 'generic' ? 'Generic' : initialModel.adapterId
  const modelMapped = report.plan.filter((item) => report.sources[item.fieldId] === 'llm-review'
    && ['fill', 'keep-rule', 'replace-rule'].includes(item.decision)).length
  const ruleMapped = report.plan.filter((item) => report.sources[item.fieldId] === 'rule-candidate'
    && ['fill', 'keep-rule', 'replace-rule'].includes(item.decision)).length
  const localSafety = report.plan.filter((item) => report.sources[item.fieldId] === 'local-safety').length
  const mapped = report.plan.filter((item) => ['fill', 'keep-rule', 'replace-rule'].includes(item.decision)).length
  const written = report.execution.results.filter((item) => item.written).length
  const committed = report.execution.results.filter((item) => item.committed).length
  const summary: FillSummary = {
    totalFields: report.ir.fields.length,
    filled,
    review,
    failed,
    unmatched: report.plan.filter((item) => item.decision === 'manual' && item.profilePaths.length === 0).length,
    manual: review,
    items,
    siteName: `${adapterName} 混合语义 Agent（${report.review.modelRequestCount} 次模型请求；模型 ${report.review.modelDecisions} / 规则与安全 ${report.review.ruleDecisions}；新增 ${report.prepared.added}；未保存/未提交）`,
    at: Date.now(),
    diagnostics: {
      modelRequests: report.review.modelRequestCount,
      modelMapped,
      ruleMapped,
      localSafety,
      mapped,
      written,
      committed,
      verified: report.execution.verified,
      rejected: report.review.rejected.length,
      entriesAdded: report.prepared.added,
    },
  }
  setStatus(`混合语义 Agent：语义映射 ${mapped}，写入 ${written}，控件提交 ${committed}，最终读回 ${filled}；未保存/未提交`)
  renderSummary(summary)
  return summary
}

async function fillPlatformV2(adapterId: 'moka' | 'dayee-wt' | 'kuma'): Promise<FillSummary> {
  const stored = await getActiveProfile()
  if (!stored) throw new Error('还没有简历档案，请先在设置页创建')
  let model = discoverPageModel(document, location.href)
  const profile = projectProfileForPage(stored, model)
  const prepared = await prepareRepeatEntries(model, profile, document)
  model = prepared.model
  const discoveredFields = model.sections.reduce((total, section) => total + section.fields.length
    + section.entries.reduce((sum, entry) => sum + entry.fields.length, 0), 0)
  if (discoveredFields === 0) {
    throw new Error('V2 未识别到可填写字段；请点击“仅扫描表单”查看 V2 分区诊断')
  }
  const platformName = adapterId === 'moka' ? 'Moka' : adapterId === 'dayee-wt' ? 'Dayee WT' : 'Kuma'
  setStatus(`${platformName} V2：全分区规划 ${model.sections.length} 个分区…`)
  const planned = await requestPagePlan(model)
  if (!planned.ok) throw new Error(planned.error || '语义规划失败')
  // Background 使用存储档案规划；Moka 的论文→项目投影在本地补一轮规则候选执行。
  const report = await executeSemanticPlan(model, profile, planned.plan, document)
  const fields = new Map(model.sections.flatMap((section) => [
    ...section.fields,
    ...section.entries.flatMap((entry) => entry.fields),
  ]).map((field) => [field.id, field]))
  const planByField = new Map(planned.plan.map((item) => [item.fieldId, item]))
  const items: FillResultItem[] = report.results.map((item) => {
    const field = fields.get(item.fieldId)
    const plan = planByField.get(item.fieldId)
    const root = field ? resolveElement(field.control.root, document) : null
    if (root) highlight(root, item.verified ? 'filled' : item.state === 'manual' ? 'review' : 'failed')
    const via = plan?.decision === 'keep-rule' ? 'rule' : 'llm'
    const phaseReason = via === 'llm'
      ? `LLM ${plan?.decision === 'replace-rule' ? '纠正' : '补填'}：${plan?.reason || '语义规划'}；${item.message}`
      : `规则候选：${plan?.reason || '匹配'}；${item.message}`
    return {
      fieldRef: { cssPath: field?.control.root.cssPath ?? '', index: field?.control.root.index ?? 0 },
      sectionKey: (model.sections.find((section) => section.fields.some((candidate) => candidate.id === item.fieldId)
        || section.entries.some((entry) => entry.fields.some((candidate) => candidate.id === item.fieldId)))?.semanticCandidates[0] ?? 'unknown'),
      profilePath: plan?.profilePaths[0] ?? '',
      label: field?.signals.label || field?.signals.placeholder || '未命名字段',
      value: '',
      confidence: plan?.confidence ?? 0,
      via,
      reason: phaseReason,
      status: item.verified ? 'filled' : item.state === 'manual' ? 'review' : 'failed',
      ...(item.state === 'failed' ? { error: item.message } : {}),
    }
  })
  const fieldCount = fields.size
  const summary: FillSummary = {
    totalFields: report.total,
    filled: report.verified,
    review: report.manual,
    failed: report.failed,
    unmatched: Math.max(0, fieldCount - planned.plan.length),
    manual: report.manual,
    items,
    siteName: `${platformName} V2（已添加 ${prepared.added} 条；未保存/未提交）`,
    at: Date.now(),
  }
  setStatus(`${platformName} V2：已验证 ${summary.filled}，待确认 ${summary.review}，失败 ${summary.failed}；未保存/未提交`)
  renderSummary(summary)
  return summary
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
