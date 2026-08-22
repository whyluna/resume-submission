import { useState } from 'react'
import type { FieldDef, SectionDef } from '@/shared/profileSchema'
import { emptyItemFor } from '@/shared/profileSchema'
import { normalizeDateValue } from '@/shared/dateValues'

type Item = Record<string, unknown>

/**
 * 元数据驱动的分区编辑器：
 * - repeat 分区：条目卡片列表（启用开关/删除/添加）
 * - 非repeat：单对象字段网格
 * onChange 全量回传新数据，父组件只管落 state。
 */
export function SectionEditor({ def, data, onChange, defaultOpen = true }: {
  def: SectionDef
  data: unknown
  onChange: (next: unknown) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const items: Item[] = def.repeat ? ((data as Item[]) ?? []) : []

  const setItem = (i: number, k: string, v: unknown) => {
    const next = items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it))
    onChange(next)
  }
  const setField = (k: string, v: unknown) => {
    onChange({ ...(data as Item), [k]: v })
  }

  const count = def.repeat ? items.length : filledCount(def, (data ?? {}) as Item)

  return (
    <div className={`sect ${open ? 'open' : ''}`} data-sect={def.key}>
      <div className="sect-hd" onClick={() => setOpen(!open)}>
        <span className="sect-arrow">{open ? '▾' : '▸'}</span>
        <b>{def.title}</b>
        <span className="sect-count">{def.repeat ? `${count} 条` : count > 0 ? `${count} 项已填` : ''}</span>
      </div>
      {open && (
        <div className="sect-bd">
          {def.key === 'selfEvaluation' ? (
            // selfEvaluation 在 Profile 上是纯字符串，不能走对象分区逻辑（否则存成 {selfEvaluation:...}）
            <FieldGrid
              def={def}
              item={{ [def.fields[0].k]: typeof data === 'string' ? data : String((data as Item)?.[def.fields[0].k] ?? '') }}
              onSet={(_k, v) => onChange(v)}
            />
          ) : def.repeat ? (
            <>
              {items.map((it, i) => (
                <div className="card" key={i}>
                  <div className="card hd">
                    <b>{def.itemTitle} {i + 1}</b>
                    <label className="note" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={it.enabled !== false} onChange={(e) => {
                        const next = items.map((x, idx) => (idx === i ? { ...x, enabled: e.target.checked } : x))
                        onChange(next)
                      }} /> 启用
                    </label>
                    <button onClick={() => onChange(items.filter((_, idx) => idx !== i))}>删除</button>
                  </div>
                  <FieldGrid def={def} item={it} onSet={(k, v) => setItem(i, k, v)} />
                </div>
              ))}
              <button className="btn ghost sm" onClick={() => onChange([...items, emptyItemFor(def.key)])}>＋ 添加{def.itemTitle}</button>
            </>
          ) : (
            <FieldGrid def={def} item={(data ?? {}) as Item} onSet={setField} />
          )}
        </div>
      )}
    </div>
  )
}

function FieldGrid({ def, item, onSet }: { def: SectionDef; item: Item; onSet: (k: string, v: unknown) => void }) {
  return (
    <div className="grid">
      {def.fields.map((f) => (
        <FieldInput
          key={f.k}
          f={f}
          value={item[f.k]}
          ongoing={f.ongoingKey ? item[f.ongoingKey] === true : false}
          onChange={(v) => onSet(f.k, v)}
          onOngoingChange={f.ongoingKey ? (v) => onSet(f.ongoingKey!, v) : undefined}
        />
      ))}
    </div>
  )
}

function FieldInput({ f, value, ongoing, onChange, onOngoingChange }: {
  f: FieldDef
  value: unknown
  ongoing: boolean
  onChange: (v: unknown) => void
  onOngoingChange?: (v: boolean) => void
}) {
  const [dateError, setDateError] = useState('')
  const display = ongoing ? '' : Array.isArray(value) ? value.join('、') : String(value ?? '')
  const handleChange = (v: string) => {
    if (f.date) setDateError('')
    onChange(f.list ? v.split(/[、,，;；\s]+/).filter(Boolean) : v)
  }
  return (
    <div className={`field ${f.ctrl === 'textarea' ? 'wide' : ''}`}>
      <label>
        {f.label}
        {f.sensitive && <span className="sens">🔒</span>}
      </label>
      {f.ctrl === 'select' ? (
        <select value={display} onChange={(e) => handleChange(e.target.value)}>
          {(f.options ?? []).map((o) => <option key={o} value={o}>{o || '（空）'}</option>)}
        </select>
      ) : f.ctrl === 'textarea' ? (
        <textarea value={display} placeholder={f.ph} onChange={(e) => handleChange(e.target.value)} />
      ) : (
        <input
          type="text"
          value={display}
          placeholder={f.ph}
          disabled={ongoing}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={(e) => {
            if (!f.date) return
            const normalized = normalizeDateValue(e.target.value)
            setDateError(normalized.valid ? '' : '日期格式无法识别，请按 YYYY、YYYY-MM 或 YYYY-MM-DD 校对')
            onChange(normalized.value)
          }}
        />
      )}
      {onOngoingChange && (
        <label className="note">
          <input type="checkbox" checked={ongoing} onChange={(e) => onOngoingChange(e.target.checked)} /> 至今 / 进行中
        </label>
      )}
      {f.date && <span className="note">统一保存为 YYYY、YYYY-MM 或 YYYY-MM-DD</span>}
      {dateError && <span className="note warn">{dateError}</span>}
      {f.sensitive && <span className="note">敏感字段，任何模式下不发给 LLM</span>}
    </div>
  )
}

function filledCount(def: SectionDef, item: Item): number {
  return def.fields.filter((f) => {
    const v = item[f.k]
    return Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim() !== ''
  }).length
}
