import { useEffect, useState } from 'react'
import type { Profile } from '@/shared/types'
import { SECTIONS } from '@/shared/profileSchema'
import {
  createEmptyProfile, ensureProfile, exportProfiles, getActiveProfileId,
  loadProfiles, parseBackup, saveProfiles, setActiveProfileId,
} from '@/shared/storage'
import { SectionEditor } from './SectionEditor'

export function ProfileTab() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeId, setActiveId] = useState('')
  const [toast, showToast] = useState('')
  const [, force] = useState(0)
  const rerender = () => force((n) => n + 1)

  useEffect(() => {
    ensureProfile().then(() =>
      loadProfiles().then((ps) => {
        setProfiles(ps)
        getActiveProfileId().then((id) => setActiveId(id ?? ps[0]?.id ?? ''))
      }),
    )
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => showToast(''), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const profile = profiles.find((p) => p.id === activeId)

  const save = async () => {
    if (!profile) return
    profile.updatedAt = new Date().toISOString()
    await saveProfiles(profiles)
    showToast('已保存')
  }

  const setSection = (key: string, next: unknown) => {
    if (!profile) return
    ;(profile as unknown as Record<string, unknown>)[key] = next
    rerender()
  }

  const importBackup = async (file: File) => {
    try {
      const imported = parseBackup(await file.text())
      const merged = [...profiles, ...imported]
      setProfiles(merged)
      await saveProfiles(merged)
      showToast(`已导入 ${imported.length} 个档案`)
    } catch (e) { alert(`导入失败：${(e as Error).message}`) }
  }

  if (!profile) return <div className="tips">档案加载中…</div>

  return (
    <div>
      <div className="toolbar">
        <select value={activeId} onChange={async (e) => { setActiveId(e.target.value); await setActiveProfileId(e.target.value) }}>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn" onClick={save}>保存档案</button>
        <button className="btn ghost" onClick={async () => {
          const p = createEmptyProfile(`档案 ${profiles.length + 1}`)
          const next = [...profiles, p]
          setProfiles(next); setActiveId(p.id)
          await saveProfiles(next); await setActiveProfileId(p.id)
        }}>＋ 新建</button>
        <button className="btn ghost" onClick={() => {
          const blob = new Blob([exportProfiles(profiles)], { type: 'application/json' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = `resume-autofill-backup-${new Date().toISOString().slice(0, 10)}.json`
          a.click()
        }}>导出全部</button>
        <label className="btn ghost" style={{ cursor: 'pointer' }}>
          导入备份<input type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importBackup(f) }} />
        </label>
        {profiles.length > 1 && (
          <button className="btn danger" onClick={async () => {
            if (!confirm(`删除档案「${profile.name}」？`)) return
            const next = profiles.filter((p) => p.id !== profile.id)
            setProfiles(next); setActiveId(next[0].id)
            await saveProfiles(next); await setActiveProfileId(next[0].id)
          }}>删除当前档案</button>
        )}
      </div>

      {SECTIONS.map((def) => (
        <SectionEditor
          key={def.key}
          def={def}
          data={(profile as unknown as Record<string, unknown>)[def.key]}
          onChange={(next) => setSection(def.key, next)}
          defaultOpen={['basic', 'intention', 'educations', 'selfEvaluation'].includes(def.key)}
        />
      ))}

      <div className="toolbar">
        <button className="btn" onClick={save}>保存档案</button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
