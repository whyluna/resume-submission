/**
 * 真实 API 冒烟：用用户自己的简历文件 + 真实 LLM 走完整链路
 *   导入（本地解析 → LLM 抽取 → 校对保存）→ 银行 mock 表单自动填写
 * 环境变量：
 *   RS_REAL_API_KEY（必填）RS_REAL_BASE RS_REAL_MODEL
 *   RS_IMPORT_FILE（默认 ~/Downloads/resume.pdf）
 *   RS_IMPORT_FILE2（可选，第二个文件，仅做导入抽取对比）
 */
import { launchExtensionBrowser, DIST } from './browser-launch.mjs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const FIXTURE = 'http://localhost:8000/bank-form.html'

const KEY = process.env.RS_REAL_API_KEY
const BASE = process.env.RS_REAL_BASE || 'https://api.deepseek.com'
const MODEL = process.env.RS_REAL_MODEL || 'deepseek-v4-flash'
const FILE1 = process.env.RS_IMPORT_FILE || path.join(os.homedir(), 'Downloads', 'resume.pdf')
const FILE2 = process.env.RS_IMPORT_FILE2 || ''
if (!KEY) { console.error('缺少 RS_REAL_API_KEY'); process.exit(2) }
console.log(`真实 API：${BASE} · ${MODEL}\n导入文件：${FILE1}${FILE2 ? `\n对比文件：${FILE2}` : ''}`)

const { ctx, cleanup } = await launchExtensionBrowser('/tmp/rs-e2e-bg-real')

function summarize(p, title) {
  const sec = (name, arr) => `${name}:${Array.isArray(arr) ? arr.length : 0}`
  console.log(`\n===== ${title} =====`)
  console.log(`姓名: ${p?.basic?.name ?? '—'} | 电话: ${p?.basic?.phone ?? '—'} | 邮箱: ${p?.basic?.email ?? '—'} | 政治面貌: ${p?.basic?.politicalStatus || '—'}`)
  console.log(`分区: ${['educations', 'experiences', 'projects', 'papers', 'competitions', 'awards', 'studentWork', 'languages', 'certificates', 'familyMembers'].map((k) => sec(k, p?.[k])).join('  ')}`)
  for (const e of p?.educations ?? []) console.log(`  教育: ${e.startDate}~${e.endDate} ${e.school} ${e.major} ${e.education}${e.degree ? '/' + e.degree : ''}${e.gpa ? ` GPA:${e.gpa}` : ''}${e.rankPercent ? ` 排名:${e.rankPercent}` : ''}`)
  for (const e of p?.experiences ?? []) console.log(`  经历(${e.kind}): ${e.startDate}~${e.endDate} ${e.company} ${e.title}`)
  for (const e of p?.papers ?? []) console.log(`  论文: ${e.title} @ ${e.venue}（${e.authorOrder || '—'}）介绍：${(e.description ?? '').slice(0, 50)}`)
  for (const e of p?.projects ?? []) console.log(`  项目: ${e.name}（${(e.techStack ?? []).join('/')}）`)
  for (const e of (p?.awards ?? []).concat(p?.competitions ?? [])) console.log(`  奖项: ${e.name} ${e.level || ''} ${e.date || ''}`)
  for (const e of p?.languages ?? []) console.log(`  语言: ${e.language} ${e.certificate || ''} ${e.score || ''}`)
  console.log(`  自我评价: ${(p?.selfEvaluation ?? '').slice(0, 60)}${(p?.selfEvaluation ?? '').length > 60 ? '…' : ''}`)
}

try {
  const id = Array.from(createHash('sha256').update(DIST, 'utf8').digest('hex').slice(0, 32))
    .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')
  const opt = await ctx.newPage()
  await opt.goto(`chrome-extension://${id}/src/options/options.html`)
  await opt.evaluate(async (s) => { await chrome.storage.local.set({ 'rs.settings': s }) }, {
    apiBaseUrl: BASE, apiKey: KEY, model: MODEL, privacyMode: 'with-values', autoPager: false,
  })

  async function importFile(file, label) {
    await opt.bringToFront()
    await opt.click('nav button:has-text("文档导入")')
    await opt.setInputFiles('#rs-import-file', file)
    await opt.waitForSelector('#rs-import-text', { timeout: 20000 })
    const textLen = ((await opt.textContent('#rs-import-text')) ?? '').length
    console.log(`\n[${label}] 本地解析文本 ${textLen} 字`)
    await opt.click('#rs-extract-btn')
    try {
      await opt.waitForSelector('#rs-import-save', { timeout: 180000 })
    } catch {
      const diag = await opt.evaluate(() => ({
        warn: Array.from(document.querySelectorAll('.tips.warn')).map((e) => e.textContent?.trim()).join(' | '),
        btn: document.querySelector('#rs-extract-btn')?.textContent?.trim(),
      }))
      throw new Error(`抽取未完成：${JSON.stringify(diag)}`)
    }
    await opt.click('#rs-import-save')
    await opt.waitForFunction(() => (document.querySelector('.toast')?.textContent ?? '').includes('已保存'), { timeout: 10000 })
    const prof = await opt.evaluate(async () => {
      const o = await chrome.storage.local.get(['rs.profiles', 'rs.activeProfileId'])
      return (o['rs.profiles'] ?? []).find((p) => p.id === o['rs.activeProfileId'])
    })
    summarize(prof, `${label} 抽取结果`)
    return prof
  }

  const profile = await importFile(FILE1, '主文件')

  // 填写
  const page = await ctx.newPage()
  await page.goto(FIXTURE, { waitUntil: 'load' })
  const send = (type) => opt.evaluate(async ({ url, type }) => {
    for (let i = 0; i < 15; i++) {
      try {
        const [tab] = await chrome.tabs.query({ url: `${url}/*` })
        return await chrome.tabs.sendMessage(tab.id, { type })
      } catch (e) { if (i === 14) throw e; await new Promise((r) => setTimeout(r, 400)) }
    }
  }, { url: FIXTURE, type })
  const summary = await send('CONTENT_FILL')
  console.log(`\n===== 填写结果（${summary.siteName}）=====`)
  console.log(`✅已填 ${summary.filled}  🟠待确认 ${summary.review}  ❌失败 ${summary.failed}  未匹配 ${summary.unmatched}  需手动 ${summary.manual}`)
  for (const it of summary.items.filter((i) => i.status !== 'filled').slice(0, 15)) {
    console.log(`  ${it.status === 'failed' ? '❌' : '🟠'} [${it.via}] ${it.label} ← ${it.profilePath}：${(it.error ?? it.reason).slice(0, 50)}`)
  }
  const dom = await page.evaluate(() => ({
    name: document.querySelector('#f_name')?.value,
    phone: document.querySelector('#f_phone')?.value,
    eduSlots: document.querySelectorAll('.edu-slot').length,
    edu1: document.querySelector('.edu-slot .edu_school')?.value,
    selfEval: (document.querySelector('#self_eval')?.value ?? '').slice(0, 40),
    growth: document.querySelector('#f_growth')?.value,
  }))
  console.log('表单抽查:', JSON.stringify(dom))

  if (FILE2) await importFile(FILE2, '对比文件')
  await page.screenshot({ path: path.join(ROOT, 'e2e', 'real-fill.png'), fullPage: true })
  console.log('\n截图：e2e/real-fill.png')
  const pass = !!profile?.basic?.name && summary.filled >= 15
  console.log(pass ? '\n🎉 真实链路冒烟通过' : '\n⚠️ 结果偏弱，看上面明细')
  process.exitCode = pass ? 0 : 1
} finally {
  await cleanup()
}
