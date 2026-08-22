import { useState } from 'react'
import { ProfileTab } from './ProfileTab'
import { ImportTab } from './ImportTab'
import { SettingsTab } from './SettingsTab'

type Tab = 'profile' | 'import' | 'settings'

export function App() {
  const [tab, setTab] = useState<Tab>('profile')
  return (
    <>
      <header><span className="logo" /><b>秋招简历自动填写</b><span className="note">数据仅保存在本机 chrome.storage</span></header>
      <nav>
        <button className={tab === 'profile' ? 'on' : ''} onClick={() => setTab('profile')}>简历档案</button>
        <button className={tab === 'import' ? 'on' : ''} onClick={() => setTab('import')}>文档导入</button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>API 与偏好</button>
      </nav>
      <main>
        {tab === 'profile' && <ProfileTab />}
        {tab === 'import' && <ImportTab onGoSettings={() => setTab('settings')} />}
        {tab === 'settings' && <SettingsTab />}
      </main>
    </>
  )
}
