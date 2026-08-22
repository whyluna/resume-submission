import { useEffect, useState } from 'react'
import type { LlmTestRes, Settings } from '@/shared/types'
import { getSettings, saveSettings } from '@/shared/storage'

export function SettingsTab() {
  const [s, setS] = useState<Settings | null>(null)
  const [testing, setTesting] = useState(false)
  const [testRes, setTestRes] = useState<LlmTestRes | null>(null)
  const [toast, showToast] = useState('')

  useEffect(() => { getSettings().then(setS) }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => showToast(''), 2200)
    return () => clearTimeout(t)
  }, [toast])
  if (!s) return null
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v })

  return (
    <div>
      <h2>大模型 API（OpenAI 兼容）</h2>
      <div className="grid">
        <div className="field">
          <label>API Base URL</label>
          <input value={s.apiBaseUrl} placeholder="https://api.deepseek.com（或 https://api.deepseek.com/v1）" onChange={(e) => set('apiBaseUrl', e.target.value)} />
        </div>
        <div className="field">
          <label>API Key</label>
          <input type="password" value={s.apiKey} placeholder="sk-…" onChange={(e) => set('apiKey', e.target.value)} />
          <span className="note">仅存本机 chrome.storage，仅 background 调用</span>
        </div>
        <div className="field">
          <label>模型名</label>
          <input value={s.model} placeholder="deepseek-v4-flash / glm-4.6 / qwen-plus / gpt-4o-mini" onChange={(e) => set('model', e.target.value)} />
        </div>
        <div className="field">
          <label>隐私模式</label>
          <select value={s.privacyMode} onChange={(e) => set('privacyMode', e.target.value as Settings['privacyMode'])}>
            <option value="with-values">with-values（发送简历值，匹配更准，支持改写）</option>
            <option value="labels-only">labels-only（只发字段标签，值不出本机）</option>
            <option value="off">off（纯规则，不调用 LLM）</option>
          </select>
        </div>
      </div>
      <p className="note" style={{ margin: '8px 0 16px' }}>
        身份证号、家庭成员姓名/电话、证件照在任何模式下都不外发。off 档下「文档导入」仅提供本地文本解析。
      </p>
      <div className="toolbar">
        <button className="btn ghost" disabled={testing} onClick={async () => {
          setTesting(true); setTestRes(null)
          try { setTestRes(await chrome.runtime.sendMessage({ type: 'LLM_TEST' })) } finally { setTesting(false) }
        }}>{testing ? '测试中…' : '测试连通性'}</button>
        <button className="btn" onClick={async () => { await saveSettings(s); showToast('设置已保存') }}>保存设置</button>
        {testRes && <span className={testRes.ok ? 'msg-ok' : 'msg-err'}>{testRes.message}{testRes.latencyMs ? `（${testRes.latencyMs}ms）` : ''}</span>}
      </div>

      <h2>填写偏好</h2>
      <div className="field">
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={s.autoPager} onChange={(e) => set('autoPager', e.target.checked)} />
          多页表单自动翻页（默认半自动：每页填完停下等你核对，自己点「下一步」后插件继续填下一页）
        </label>
      </div>
      <div className="toolbar"><button className="btn" onClick={async () => { await saveSettings(s); showToast('设置已保存') }}>保存设置</button></div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
