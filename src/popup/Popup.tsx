import { useEffect, useState } from 'react'
import type { FillSummary, GetStateRes, Profile, ScanRes } from '@/shared/types'
import {
  getActiveProfileId, loadProfiles, setActiveProfileId,
} from '@/shared/storage'

export function Popup() {
  const [state, setState] = useState<GetStateRes | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [busy, setBusy] = useState<'scan' | 'fill' | null>(null)
  const [scanRes, setScanRes] = useState<ScanRes | null>(null)
  const [fillRes, setFillRes] = useState<FillSummary | null>(null)
  const [err, setErr] = useState('')

  const refresh = async () => {
    const st = (await chrome.runtime.sendMessage({ type: 'GET_STATE' })) as GetStateRes
    setState(st)
    const ps = await loadProfiles()
    setProfiles(ps)
    setActiveId((await getActiveProfileId()) ?? ps[0]?.id ?? '')
  }
  useEffect(() => { refresh() }, [])

  const sendToContent = async <T,>(msg: object): Promise<T> => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab.id) throw new Error('找不到当前标签页')
    return chrome.tabs.sendMessage(tab.id, msg) as Promise<T>
  }

  const onScan = async () => {
    setErr(''); setFillRes(null); setBusy('scan')
    try { setScanRes(await sendToContent<ScanRes>({ type: 'CONTENT_SCAN' })) }
    catch (e) { setErr(`无法连接页面脚本：${(e as Error).message}。若刚安装插件，请刷新投递页后重试。`) }
    finally { setBusy(null) }
  }

  const onFill = async () => {
    setErr(''); setScanRes(null); setBusy('fill')
    try { setFillRes(await sendToContent<FillSummary>({ type: 'CONTENT_FILL' })) }
    catch (e) { setErr(`无法连接页面脚本：${(e as Error).message}。若刚安装插件，请刷新投递页后重试。`) }
    finally { setBusy(null) }
  }

  const openOptions = () => chrome.runtime.openOptionsPage()
  const hasProfile = profiles.length > 0 && activeId

  return (
    <>
      <h1><span className="logo" /> 秋招简历自动填写</h1>

      <div className="site">
        <span className="name">{state?.siteName ?? '…'}</span>
        {state && <span className="tag">{state.siteAdapter}</span>}
      </div>
      {state && !state.canInject && (
        <div className="warn">当前页面不支持注入（chrome:// 或商店页）。请打开普通网页（http/https）后使用。</div>
      )}

      <label>使用简历档案</label>
      <select value={activeId} onChange={async (e) => { setActiveId(e.target.value); await setActiveProfileId(e.target.value) }}>
        {profiles.length === 0 && <option value="">（还没有档案，去设置页创建）</option>}
        {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      {state?.canInject && (
        <>
          <button className="btn ghost" disabled={!hasProfile || busy !== null} onClick={onScan}>
            {busy === 'scan' ? <span className="spin">↻</span> : ''} 仅扫描表单
          </button>
          <button className="btn" disabled={!hasProfile || busy !== null} onClick={onFill}>
            {busy === 'fill' ? <span className="spin">↻</span> : '⚡'} 开始填写
          </button>
        </>
      )}

      {scanRes && (
        <div className="result">
          <b>扫描到 {scanRes.groups.length} 个分区</b>
          <div className="list">
            {scanRes.groups.map((g, i) => (
              <div key={i}>{g.sectionHint || g.sectionKey} · {g.fieldCount} 字段{g.hasAddButton ? ' · 有添加按钮' : ''}</div>
            ))}
          </div>
        </div>
      )}

      {fillRes && (
        <div className="result">
          <div className="counts">
            <span className="chip ok">✅ 已填 {fillRes.filled}</span>
            <span className="chip re">🟠 待确认 {fillRes.review}</span>
            <span className="chip fail">❌ 失败 {fillRes.failed}</span>
            <span className="chip un">未匹配 {fillRes.unmatched}</span>
            <span className="chip man">需手动 {fillRes.manual}</span>
          </div>
          <div className="list">
            {fillRes.items.filter((i) => i.status !== 'filled').slice(0, 8).map((i, k) => (
              <div key={k}>{i.status === 'failed' ? '❌' : '🟠'} {i.label}：{i.error ?? i.reason}</div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>只填不提交。详情见页面右下角面板。</div>
        </div>
      )}

      {err && <div className="warn">{err}</div>}

      <div className="foot">
        <a onClick={openOptions}>设置 / 编辑简历档案 / API 配置</a>
      </div>
    </>
  )
}
