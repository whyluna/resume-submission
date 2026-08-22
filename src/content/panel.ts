import type { FillSummary } from '@/shared/types'

let host: HTMLDivElement | null = null
let body: HTMLDivElement | null = null
let collapsed = false

const STYLE = `
  :host { all: initial }
  .panel {
    position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
    width: 320px; max-height: 60vh; overflow: auto;
    background: #fff; color: #1f2937;
    border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.18);
    font: 13px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .hd {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px; color: #fff; background: #4f46e5;
    position: sticky; top: 0; border-radius: 12px 12px 0 0;
  }
  .hd b { flex: 1; font-size: 13px }
  .hd button { all: unset; cursor: pointer; color: #fff; opacity: .85; padding: 0 4px }
  .bd { padding: 10px 14px 14px }
  .status { color: #6b7280; margin-bottom: 8px; word-break: break-all }
  .counts { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px }
  .chip { padding: 2px 10px; border-radius: 999px; font-size: 12px }
  .c-ok { background: #dcfce7; color: #15803d }
  .c-re { background: #ffedd5; color: #c2410c }
  .c-fail { background: #fee2e2; color: #b91c1c }
  .c-un { background: #f3f4f6; color: #6b7280 }
  .c-man { background: #fef9c3; color: #a16207 }
  ul { margin: 0; padding: 0; list-style: none }
  li { padding: 6px 0; border-top: 1px dashed #e5e7eb }
  li .lab { font-weight: 600 }
  li .val { color: #6b7280; word-break: break-all }
  li .why { color: #9ca3af; font-size: 12px }
  .tip { color: #9ca3af; font-size: 12px; margin-top: 8px }
  .diag { padding: 7px 9px; margin: 8px 0; border-radius: 8px; background: #f8fafc; color: #475569; font-size: 12px }
`

function ensurePanel(): void {
  if (host?.isConnected) return
  host = document.createElement('div')
  host.dataset.rsPanel = '1'
  const root = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = STYLE
  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.innerHTML = `
    <div class="hd"><b>秋招填写助手</b><button data-act="fold" title="收起/展开">—</button><button data-act="close" title="关闭">×</button></div>
    <div class="bd"><div class="status">待命</div></div>
  `
  root.append(style, panel)
  document.documentElement.append(host)
  body = panel.querySelector('.bd') as HTMLDivElement
  panel.querySelector('[data-act=close]')?.addEventListener('click', () => hidePanel())
  panel.querySelector('[data-act=fold]')?.addEventListener('click', (e) => {
    collapsed = !collapsed
    body!.style.display = collapsed ? 'none' : ''
    ;(e.target as HTMLElement).textContent = collapsed ? '▢' : '—'
  })
}

export function hidePanel(): void {
  host?.remove()
  host = null
  body = null
}

export function setStatus(text: string): void {
  ensurePanel()
  const el = body!.querySelector('.status') as HTMLElement
  el.textContent = text
}

export function renderSummary(s: FillSummary): void {
  ensurePanel()
  const chip = (n: number, label: string, cls: string) => `<span class="chip ${cls}">${label} ${n}</span>`
  const rows = s.items
    .filter((it) => it.status === 'review' || it.status === 'failed')
    .map((it) => `
      <li>
        <div class="lab">${it.status === 'failed' ? '❌' : '🟠'} ${it.label || '(无标签字段)'} ← ${it.profilePath}</div>
        <div class="val">填入：「${String(it.value ?? '').slice(0, 60) || '—'}」</div>
        <div class="why">${it.error ?? it.reason}</div>
      </li>`)
    .join('')
  body!.innerHTML = `
    <div class="status">${s.siteName} · ${new Date(s.at).toLocaleTimeString()}</div>
    <div class="counts">
      ${chip(s.filled, '✅ 已填', 'c-ok')}
      ${chip(s.review, '🟠 待确认', 'c-re')}
      ${chip(s.failed, '❌ 失败', 'c-fail')}
      ${chip(s.unmatched, '未匹配', 'c-un')}
      ${chip(s.manual, '需手动', 'c-man')}
    </div>
    ${s.diagnostics ? `<div class="diag">
      语义映射 ${s.diagnostics.mapped}（LLM ${s.diagnostics.modelMapped} / 规则 ${s.diagnostics.ruleMapped} / 安全决策 ${s.diagnostics.localSafety}）<br>
      本地执行：写入 ${s.diagnostics.written} → 控件提交 ${s.diagnostics.committed} → 最终读回 ${s.diagnostics.verified}<br>
      模型请求 ${s.diagnostics.modelRequests} 次 · 计划拒绝 ${s.diagnostics.rejected} · 新增条目 ${s.diagnostics.entriesAdded}
    </div>` : ''}
    <ul>${rows || '<li class="why">没有待确认项 🎉</li>'}</ul>
    <div class="tip">只填不提交——请逐项核对，橙/红项点击页面字段可定位修改。</div>
  `
}
