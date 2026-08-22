// 调试：扩展在 moka-resume 上的填写细节（加载扩展 + 种档案 + CONTENT_FILL + 逐步 dump）
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { launchExtensionBrowser } from './browser-launch.mjs'
import { startMockLlm } from './mock-llm.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtures = path.join(ROOT, 'e2e', 'fixtures')
const server = spawn('python3', ['-m', 'http.server', '8000'], { cwd: fixtures, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 800))
const mock = await startMockLlm()

const PROFILE_DIR = '/tmp/rs-debug-profile'
spawn('rm', ['-rf', PROFILE_DIR])

const PROFILE = {
  schemaVersion: 1, id: 'dbg', name: '调试档案', updatedAt: new Date().toISOString(),
  basic: { name: '张三丰', phone: '13800001234', email: 'zsf@example.com', nativePlace: '广东省 广州市' },
  intention: { cities: ['杭州市'], positions: ['后端开发工程师'] },
  educations: [
    { enabled: true, school: '示例理工大学', major: '计算机科学与技术', education: '本科', startDate: '2018-09', endDate: '2022-06', endDateIsNow: false },
    { enabled: true, school: '示例大学', major: '软件工程', education: '硕士研究生', startDate: '2022-09', endDate: '至今', endDateIsNow: true },
  ],
  experiences: [], projects: [
    { enabled: true, name: '校园二手书交易平台', role: '后端负责人', startDate: '2023-03', endDate: '2023-09', description: '从 0 到 1 搭建交易平台后端，支撑日均千单。' },
  ], papers: [], competitions: [], awards: [{ enabled: true, name: '国家奖学金', level: '国家级', date: '2023-10' }],
  studentWork: [], languages: [{ enabled: true, language: '英语', certificate: 'CET-6', score: '580' }],
  itSkills: [], certificates: [], familyMembers: [], selfEvaluation: '调试自我评价', openAnswers: [],
}

const { ctx, cleanup } = await launchExtensionBrowser(PROFILE_DIR)
try {
  const opt = await ctx.newPage()
  await opt.goto(`chrome-extension://pihllffpbeeamfkblfjgkfhckflfljnd/src/options/options.html`)
  // 等 ensureProfile 初始化完成再种数据（否则会被保存的初始状态覆盖）
  await opt.waitForSelector('.toolbar select option', { state: 'attached', timeout: 10000 })
  await opt.evaluate(async (p) => {
    await chrome.storage.local.set({ 'rs.profiles': [p], 'rs.activeProfileId': p.id })
    await chrome.storage.local.set({
      'rs.settings': { apiBaseUrl: 'http://localhost:8787/v1', apiKey: 'test-key', model: 'mock-model', privacyMode: 'with-values', autoPager: false },
    })
  }, PROFILE)

  const zh = await ctx.newPage()
  zh.on('console', (m) => { const t = m.text(); if (t.includes('[rs]')) console.log('[page]', t) })
  await zh.goto('http://localhost:8000/moka-resume.html', { waitUntil: 'load' })

  // 手动在页面里点一次 edu 添加按钮，对比扩展扫描出的按钮
  const scan = await opt.evaluate(async () => {
    const tabs = await chrome.tabs.query({})
    const tab = tabs.find((t) => (t.url ?? '').includes('moka-resume'))
    return await chrome.tabs.sendMessage(tab.id, { type: 'CONTENT_SCAN' })
  })
  console.log('scan groups:', JSON.stringify(scan.groups))

  const summary = await opt.evaluate(async () => {
    const tabs = await chrome.tabs.query({})
    const tab = tabs.find((t) => (t.url ?? '').includes('moka-resume'))
    return await chrome.tabs.sendMessage(tab.id, { type: 'CONTENT_FILL' })
  })
  console.log('fill:', JSON.stringify(summary, (k, v) => (k === 'items' ? v.map((i) => `${i.label || '无标签'}→${i.profilePath}[${i.status}]`) : v), 2))

  const state = await zh.evaluate(() => {
    const edu = document.querySelectorAll('.edu-card')
    const picker = edu[0]?.querySelector('.edu_range')
    return {
      eduCount: edu.length,
      edu1End: edu[0]?.querySelector('.edu_end')?.value,
      edu1EndDisabled: edu[0]?.querySelector('.edu_end')?.disabled,
      edu1Start: edu[0]?.querySelector('.edu_start')?.value,
      edu1NowChecked: edu[0]?.querySelector('.edu_now')?.checked,
      pickerDataset: { ...picker?.dataset },
      schoolVal: edu[0]?.querySelector('.edu_school')?.value,
      majorVal: edu[0]?.querySelector('.edu_major')?.value,
      eduSel: edu[0]?.querySelector('.ant-select-selection-item')?.textContent,
    }
  })
  console.log('after fill:', JSON.stringify(state))
} finally {
  await cleanup()
  server.kill()
  mock.close?.()
}
