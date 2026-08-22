// 真实站点无头扫描：验证扩展在真实 Moka 页面的分区识别/字段信号（不填写、不提交）
import { launchExtensionBrowser } from './browser-launch.mjs'

const BASE_URL = process.argv[2] ?? 'https://app.mokahr.com/campus-recruitment/zhihu/68321'
const PROFILE_DIR = '/tmp/rs-scan-profile'

const { ctx, cleanup } = await launchExtensionBrowser(PROFILE_DIR)
try {
  const page = await ctx.newPage()
  console.log('打开：', BASE_URL)
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.log('goto:', e.message))
  await page.waitForTimeout(9000) // SPA 渲染 + 懒加载

  // 先进「职位列表」
  const navClicked = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('a, [role=button], button'))
      .find((b) => /^职位列表$|^查看全部职位$/.test((b.textContent ?? '').trim()))
    if (!el) return false
    el.click()
    return true
  }).catch(() => false)
  console.log('点击「职位列表」：', navClicked)
  await page.waitForTimeout(6000)

  // 尝试进入具体职位的投递表单
  const jobLink = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map((a) => ({ href: a.getAttribute('href') ?? '', text: (a.textContent ?? '').trim().slice(0, 30) }))
      .filter((l) => /#\/job\/\d+/.test(l.href))
    return links[0] ?? null
  }).catch(() => null)
  if (!jobLink) {
    // 没有链接型职位卡：找职位卡片元素直接点
    const card = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[class*="job"], [class*="position"], [class*="card"]'))
        .filter((el) => (el.textContent ?? '').includes('岗位') || (el.textContent ?? '').includes('工程师') || (el.textContent ?? '').includes('产品'))
      if (items.length === 0) return ''
      items[items.length - 1].click() // 点最外层卡片容器
      return (items[items.length - 1].textContent ?? '').trim().slice(0, 40)
    }).catch(() => '')
    console.log('无链接型职位卡，点卡片：', card)
    await page.waitForTimeout(6000)
  }
  if (jobLink) {
    const jobUrl = jobLink.href.startsWith('#')
      ? BASE_URL.split('#')[0] + jobLink.href
      : new URL(jobLink.href, BASE_URL).href
    console.log('进入职位：', jobLink.text, jobUrl)
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(6000)
    // 点「立即投递/投递申请」按钮（如有）
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [role=button], a'))
        .filter((b) => /立即投递|投递申请|申请职位|立即申请/.test((b.textContent ?? '').trim()))
      if (btns.length === 0) return ''
      btns[0].click()
      return (btns[0].textContent ?? '').trim()
    }).catch(() => '')
    if (clicked) console.log('点击按钮：', clicked)
    await page.waitForTimeout(8000)
  }

  const urlNow = page.url()
  const title = await page.title()
  console.log('落地页：', urlNow, '·', title)

  const opt = await ctx.newPage()
  await opt.goto(`chrome-extension://pihllffpbeeamfkblfjgkfhckflfljnd/src/options/options.html`).catch(() => {})
  const scan = await opt.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({})
    const tab = tabs.find((t) => (t.url ?? '').startsWith(u))
    if (!tab) return { error: '找不到标签页' }
    try {
      return await chrome.tabs.sendMessage(tab.id, { type: 'CONTENT_SCAN' })
    } catch (e) {
      return { error: String(e) }
    }
  }, urlNow).catch((e) => ({ error: String(e) }))

  if (scan.error) {
    console.log('扫描失败：', scan.error)
  } else {
    console.log(`\n识别到 ${scan.groups.length} 个分区：`)
    for (const g of scan.groups) console.log(`  · [${g.sectionKey}] ${g.sectionHint || g.sectionKey}（${g.fieldCount} 字段${g.hasAddButton ? '，含添加按钮' : ''}）`)
  }

  // 抓取页面关键字段信号（label 原文 + 组件类名），供后续别名/适配器调优
  const signals = await page.evaluate(() => {
    const out = []
    for (const el of Array.from(document.querySelectorAll('input, textarea, select'))) {
      if (!(el instanceof HTMLElement)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const wrapCls = ['ant-select', 'el-select', 'ant-picker', 'ant-cascader', 'moka']
        .map((k) => el.closest('[class*="' + k + '"]'))
        .filter((w) => w !== null)
        .map((w) => String(w.className).slice(0, 80))
      const item = el.closest('[class*="form-item"], [class*="field"], [class*="form-group"]')
      out.push({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') ?? '',
        ph: el.getAttribute('placeholder') ?? '',
        label: (item?.querySelector('label')?.textContent ?? item?.previousElementSibling?.textContent ?? '').trim().slice(0, 20),
        cls: (el.className || '').toString().slice(0, 60),
        wrap: wrapCls[0] ?? '',
      })
    }
    return out.slice(0, 60)
  }).catch(() => [])
  console.log(`\n页面控件信号（前 ${signals.length} 个）：`)
  for (const s of signals) console.log(`  · ${s.tag}[${s.type}] label="${s.label}" ph="${s.ph}" wrap=${s.wrap || '—'}`)

  await page.screenshot({ path: 'e2e/real-zhihu-scan.png', fullPage: false })
  console.log('\n截图：e2e/real-zhihu-scan.png')
} finally {
  await cleanup()
}
