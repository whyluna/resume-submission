import type { AgentRoundResponse, ExtMessage, GetStateRes, LlmTestRes, SemanticPlannerResponse } from '@/shared/types'
import { detectSite } from '@/shared/siteDetect'
import { getActiveProfile, getSettings } from '@/shared/storage'
import { extractProfile, matchFields } from './llm'
import { planPageSemantics } from './llmPlanner'
import { planAgentRound } from './agentPlanner'
import { projectProfileForPage } from '@/shared/profileProjection'

// 快捷键 Alt+Shift+F：向当前页 content script 下发填写指令
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'fill-current-form') return
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) return
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'CONTENT_FILL' })
  } catch {
    // content script 未就绪（刚安装未刷新页面）时静默失败，用户走 popup 会得到提示
  }
})

chrome.runtime.onMessage.addListener((msg: ExtMessage, _sender, sendResponse) => {
  if (msg.type === 'GET_STATE') {
    handleGetState().then(sendResponse)
    return true
  }
  if (msg.type === 'LLM_TEST') {
    testLlm().then(sendResponse)
    return true
  }
  if (msg.type === 'LLM_EXTRACT') {
    extractProfile(msg.text).then(sendResponse)
    return true
  }
  if (msg.type === 'LLM_MATCH') {
    matchFields(msg.fields, msg.profileLines).then(sendResponse)
    return true
  }
  if (msg.type === 'LLM_PLAN_PAGE') {
    handlePlanPage(msg.model).then(sendResponse).catch((error) => sendResponse({
      ok: false, plan: [], rejected: 0, messages: [], error: `规划后台异常：${(error as Error).message}`,
    } satisfies SemanticPlannerResponse))
    return true
  }
  if (msg.type === 'LLM_AGENT_ROUND') {
    handleAgentRound(msg).then(sendResponse).catch((error) => sendResponse({
      ok: false, calls: [], coveredFieldIds: [], missingFieldIds: msg.targetFieldIds,
      rejected: [], observationFieldCount: 0, error: `Agent 后台异常：${(error as Error).message}`,
    } satisfies AgentRoundResponse))
    return true
  }
  return false
})

async function handlePlanPage(model: Parameters<typeof planPageSemantics>[0]): Promise<SemanticPlannerResponse> {
  const [profile, settings] = await Promise.all([getActiveProfile(), getSettings()])
  if (!profile) return { ok: false, plan: [], rejected: 0, messages: [], error: '没有可用简历档案' }
  try {
    const planned = await planPageSemantics(model, projectProfileForPage(profile, model), settings)
    return { ok: true, plan: planned.accepted, rejected: planned.rejected.length, messages: planned.messages }
  } catch (error) {
    return { ok: false, plan: [], rejected: 0, messages: [], error: (error as Error).message }
  }
}

async function handleAgentRound(msg: Extract<ExtMessage, { type: 'LLM_AGENT_ROUND' }>): Promise<AgentRoundResponse> {
  const [stored, settings] = await Promise.all([getActiveProfile(), getSettings()])
  if (!stored) return {
    ok: false, calls: [], coveredFieldIds: [], missingFieldIds: msg.targetFieldIds,
    rejected: [], observationFieldCount: 0, error: '没有可用简历档案',
  }
  const profile = projectProfileForPage(stored, msg.model)
  const planned = await planAgentRound(msg.model, profile, settings, {
    round: msg.round,
    targetFieldIds: msg.targetFieldIds,
    previousResults: msg.previousResults,
    previousIssues: msg.previousIssues,
  })
  return {
    ok: true,
    calls: planned.calls,
    coveredFieldIds: planned.coveredFieldIds,
    missingFieldIds: planned.missingFieldIds,
    rejected: planned.rejected.map((item) => item.reason),
    trace: planned.trace,
    observationFieldCount: planned.observationFieldCount,
  }
}

async function handleGetState(): Promise<GetStateRes> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tab?.url ?? null
  const site = detectSite(url)
  // chrome:// / edge:// / chrome web store 等页面无法注入 content script
  const canInject = !!url && /^https?:/i.test(url)
  return { url, siteName: site.siteName, siteAdapter: site.adapter, canInject }
}

/**
 * LLM 连通性测试：OpenAI 兼容 /chat/completions。
 * 所有 LLM 请求统一走 background（无 CORS 限制），API key 不进入页面上下文。
 */
export async function testLlm(): Promise<LlmTestRes> {
  const s = await getSettings()
  if (!s.apiBaseUrl || !s.apiKey || !s.model) {
    return { ok: false, message: '请先填写 API Base URL、API Key 和模型名' }
  }
  const base = s.apiBaseUrl.replace(/\/+$/, '')
  const t0 = Date.now()
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
      body: JSON.stringify({
        model: s.model,
        messages: [{ role: 'user', content: '回复"ok"两个字母即可，不要其他内容。' }],
        max_tokens: 256, // 推理模型会把 token 花在思考上，预算太小会返回空内容
        temperature: 0,
      }),
    })
    const latencyMs = Date.now() - t0
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, message: `HTTP ${res.status}：${body.slice(0, 200) || res.statusText}`, latencyMs }
    }
    const data = await res.json()
    const reply: string = data?.choices?.[0]?.message?.content ?? ''
    return { ok: true, message: `连通成功，模型返回："${reply.trim().slice(0, 30)}"`, latencyMs }
  } catch (e) {
    return { ok: false, message: `请求失败：${(e as Error).message}。请检查 Base URL（通常以 /v1 结尾）与网络。` }
  }
}

export {}
