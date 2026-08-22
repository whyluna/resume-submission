import { useRef, useState } from 'react'
import type { LlmExtractRes, Profile, Settings } from '@/shared/types'
import { SECTIONS } from '@/shared/profileSchema'
import { createEmptyProfile, getSettings, loadProfiles, saveProfiles, setActiveProfileId } from '@/shared/storage'
import { cleanResumeText, extractTextFromFile, type ParsedDoc } from '@/lib/docParse'
import { SectionEditor } from './SectionEditor'

type Stage = 'pick' | 'extracted' | 'review'

export function ImportTab({ onGoSettings }: { onGoSettings: () => void }) {
  const [stage, setStage] = useState<Stage>('pick')
  const [doc, setDoc] = useState<ParsedDoc | null>(null)
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<Profile | null>(null)
  const [busy, setBusy] = useState<'parse' | 'llm' | 'save' | null>(null)
  const [err, setErr] = useState('')
  const [apiReady, setApiReady] = useState<boolean | null>(null)
  const [toast, showToast] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  /** 复位令牌：新解析开始时递增，作废未触发的「保存后重置」定时器，避免清掉新内容 */
  const resetToken = useRef(0)

  const checkApi = async () => {
    const s: Settings = await getSettings()
    const ready = !!(s.apiBaseUrl && s.apiKey && s.model)
    setApiReady(ready)
    return ready
  }

  const loadText = async (t: string, d?: ParsedDoc) => {
    resetToken.current++
    setErr('')
    const cleaned = cleanResumeText(t)
    if (!cleaned) { setErr('没有解析出文本，换一个文件或直接粘贴'); return }
    setText(cleaned)
    setDoc(d ?? null)
    setStage('extracted')
  }

  const onFile = async (file: File) => {
    setBusy('parse'); setErr('')
    try {
      const parsed = await extractTextFromFile(file)
      await loadText(parsed.text, parsed)
    } catch (e) { setErr(`解析失败：${(e as Error).message}`) }
    finally { setBusy(null); if (fileRef.current) fileRef.current.value = '' }
  }

  const runExtract = async () => {
    const ready = await checkApi()
    if (!ready) { setErr('未配置 API，请先到「API 与偏好」填写'); return }
    setBusy('llm'); setErr('')
    try {
      const res = (await chrome.runtime.sendMessage({ type: 'LLM_EXTRACT', text })) as LlmExtractRes
      if (!res.ok || !res.draft) { setErr(res.message); return }
      const base = createEmptyProfile('导入档案')
      const merged = { ...base, ...res.draft, id: base.id, schemaVersion: 1 as const } as Profile
      merged.name = draftName(merged)
      setDraft(merged)
      setStage('review')
    } catch (e) { setErr(`抽取失败：${(e as Error).message}`) }
    finally { setBusy(null) }
  }

  const saveAsNew = async () => {
    if (!draft) return
    setBusy('save')
    try {
      const profiles = await loadProfiles()
      draft.updatedAt = new Date().toISOString()
      const next = [...profiles, draft]
      await saveProfiles(next)
      await setActiveProfileId(draft.id)
      showToast(`已保存为「${draft.name}」并设为当前档案`)
      const token = resetToken.current
      setTimeout(() => {
        if (resetToken.current !== token) return
        setStage('pick'); setDraft(null); setDoc(null); setText('')
      }, 900)
    } finally { setBusy(null) }
  }

  const setSection = (key: string, value: unknown) => {
    if (!draft) return
    setDraft({ ...draft, [key]: value } as Profile)
  }

  return (
    <div id="rs-import">
      {apiReady === false && (
        <div className="tips warn">
          还没配置大模型 API，抽取功能不可用（文本解析不受影响）。
          <a onClick={onGoSettings} style={{ marginLeft: 8, cursor: 'pointer', textDecoration: 'underline' }}>去配置 →</a>
        </div>
      )}

      {stage !== 'review' && (
        <div className="import-step">
          <h2>① 选择简历文件或粘贴文本</h2>
          <div className="toolbar">
            <label className="btn" style={{ cursor: 'pointer' }}>
              {busy === 'parse' ? '解析中…' : '选择 PDF / DOCX / TXT'}
              <input id="rs-import-file" ref={fileRef} type="file" accept=".pdf,.docx,.txt" hidden
                disabled={busy !== null} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
            </label>
            <span className="note">本地解析，文件不上传</span>
          </div>
          <div className="field">
            <label>或直接粘贴简历文本</label>
            <textarea id="rs-import-paste" style={{ minHeight: 110 }} placeholder="把简历全文粘到这里（适用于图片型 PDF / 在线简历页复制）"
              onBlur={(e) => { if (e.target.value.trim()) loadText(e.target.value) }} />
          </div>
        </div>
      )}

      {stage !== 'pick' && text && (
        <div className="import-step">
          <h2>② 解析出的文本（{doc ? `${doc.kind.toUpperCase()}${doc.pages ? ` · ${doc.pages} 页` : ''}` : '粘贴'} · {text.length} 字）</h2>
          {doc?.lowDensity && (
            <div className="tips warn">文本密度低（可能是扫描件/图片型 PDF），抽取效果会打折——建议改用粘贴文本。</div>
          )}
          <pre id="rs-import-text" className="text-preview">{text.slice(0, 4000)}</pre>
          {stage === 'extracted' && (
            <div className="toolbar">
              <button id="rs-extract-btn" className="btn" disabled={busy !== null} onClick={runExtract}>
                {busy === 'llm' ? 'AI 抽取中…（最长 150s）' : '③ AI 结构化抽取 →'}
              </button>
            </div>
          )}
        </div>
      )}

      {stage === 'review' && draft && (
        <div className="import-step">
          <h2>③ 校对抽取结果（改完再入库）</h2>
          <div className="toolbar">
            <span className="note">左侧原文仅供对照。确认无误后「另存为新档案」并设为当前档案。</span>
          </div>
          <div className="review-cols">
            <div className="review-left"><pre className="text-preview">{text.slice(0, 6000)}</pre></div>
            <div className="review-right">
              {SECTIONS.map((def) => {
                const data = (draft as unknown as Record<string, unknown>)[def.key]
                const hasContent = Array.isArray(data) ? data.length > 0
                  : def.key === 'selfEvaluation' ? !!draft.selfEvaluation
                    : Object.values((data ?? {}) as Record<string, unknown>).some((v) => (Array.isArray(v) ? v.length : typeof v === 'string' && v))
                return (
                  <SectionEditor key={def.key} def={def} data={data} onChange={(next) => setSection(def.key, next)} defaultOpen={hasContent} />
                )
              })}
            </div>
          </div>
          <div className="toolbar">
            <button id="rs-import-save" className="btn" disabled={busy !== null} onClick={saveAsNew}>
              {busy === 'save' ? '保存中…' : `另存为新档案「${draft.name}」`}
            </button>
            <button className="btn ghost" disabled={busy !== null} onClick={() => setStage('extracted')}>← 重新抽取</button>
          </div>
        </div>
      )}

      {err && <div className="tips warn">{err}</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function draftName(p: Profile): string {
  return p.basic.name ? `${p.basic.name}的档案` : `导入档案 ${new Date().toISOString().slice(5, 10)}`
}
