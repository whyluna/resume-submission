/**
 * 自动化 E2E（两阶段）：
 *  阶段一 规则填写：加载 dist/ 扩展 → 种入测试档案 → 银行 mock 表单 → 扫描/匹配/自动点添加按钮/填写 + LLM 兜底
 *  阶段二 文档导入：options 导入向导 → DOCX/PDF 本地解析 → LLM 结构化抽取 → 校对 → 另存档案 → 用新档案再填一轮
 * 运行：node e2e/run-e2e.mjs
 *  真实 API：RS_REAL_API_KEY=sk-xxx RS_REAL_BASE=https://api.deepseek.com RS_REAL_MODEL=deepseek-v4-flash node e2e/run-e2e.mjs
 * 前置：npm run build；fixtures 服务 8000 端口（npm run e2e 会自动起）
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlm } from './mock-llm.mjs'
import { launchExtensionBrowser, DIST } from './browser-launch.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PROFILE_DIR = '/tmp/rs-e2e-bg-mock'
const FIXTURE = 'http://localhost:8000/bank-form.html'

const REAL = {
  key: process.env.RS_REAL_API_KEY,
  base: process.env.RS_REAL_BASE || 'https://api.deepseek.com',
  model: process.env.RS_REAL_MODEL || 'deepseek-v4-flash',
}
const isReal = !!REAL.key

// ---------- 测试档案（阶段一直接种入 storage） ----------
const TEST_PROFILE = {
  schemaVersion: 1,
  id: 'e2e-profile',
  name: 'E2E 测试档案',
  updatedAt: new Date().toISOString(),
  basic: {
    name: '张三丰', lastName: '', firstName: '', englishName: '', gender: '男',
    birthDate: '2001-03-15', nation: '汉族', politicalStatus: '共青团员',
    idType: '身份证', idNumber: '440101200103151234', phone: '13800001234',
    email: 'zsf@example.com', wechat: '', qq: '', nativePlace: '广东省 广州市',
    hukou: '广东省 广州市', hometown: '', currentCity: '浙江省 杭州市', address: '',
    height: '178', weight: '', maritalStatus: '未婚', health: '健康',
    emergencyContactName: '', emergencyContactRelation: '', emergencyContactPhone: '',
    hobbies: '', homepage: 'https://github.com/zsf',
  },
  intention: { cities: ['杭州市', '深圳市'], positions: ['后端开发工程师'], salaryMin: '20', salaryMax: '30', availableDate: '2026-07', internDaysPerWeek: '', internMonths: '', acceptRelocation: '是', notes: '' },
  educations: [
    { enabled: true, school: '示例理工大学', schoolCity: '', college: '计算机学院', major: '计算机科学与技术', degree: '学士', education: '本科', startDate: '2018-09', endDate: '2022-06', endDateIsNow: false, studyMode: '全日制', eduType: '统招', schoolLevel: '', gpa: '3.6', gpaTotal: '4.0', rankPercent: '前15%', ranking: '', isHighest: '否', isOverseas: '否', courses: '数据结构、操作系统、计算机网络', researchDirection: '', thesisTitle: '' },
    { enabled: true, school: '示例大学', schoolCity: '', college: '计算机学院', major: '软件工程', degree: '硕士', education: '硕士研究生', startDate: '2022-09', endDate: '2026-06', endDateIsNow: false, studyMode: '全日制', eduType: '统招', schoolLevel: '985', gpa: '3.8', gpaTotal: '4.0', rankPercent: '前10%', ranking: '', isHighest: '是', isOverseas: '否', courses: '高级软件工程、分布式系统', researchDirection: '', thesisTitle: '' },
  ],
  experiences: [
    { enabled: true, kind: 'internship', company: '示例科技有限公司', city: '杭州市', department: '基础架构部', title: '后端开发实习生', startDate: '2024-06', endDate: '2024-12', endDateIsNow: false, description: '负责内部平台的接口开发与性能优化，将核心查询耗时降低 40%。', achievements: '', skills: [] },
  ],
  projects: [
    { enabled: true, name: '校园二手书交易平台', role: '后端负责人', startDate: '2023-03', endDate: '2023-09', url: '', description: '从 0 到 1 搭建交易平台后端，支撑日均千单。', contribution: '', achievements: '', techStack: ['Python', 'FastAPI', 'MySQL'] },
  ],
  papers: [
    { enabled: true, title: '分布式场景下的参数调优框架', venue: 'IEEE TPDS', publishDate: '2025-06', authorOrder: '第一作者', indexed: 'CCF-A', link: '', description: '提出分布式训练参数调优框架，实测训练吞吐提升 30%，代码已开源。' },
  ],
  competitions: [],
  awards: [
    { enabled: true, name: '国家奖学金', level: '国家级', date: '2023-10' },
  ],
  studentWork: [],
  languages: [
    { enabled: true, language: '英语', certificate: 'CET-6', score: '580', date: '2020-12', proficiency: '熟练' },
  ],
  itSkills: [],
  certificates: [],
  familyMembers: [
    { enabled: true, relation: '父亲', name: '张大山', age: '55', company: '个体经营', position: '经营者', politicalStatus: '群众', phone: '13900000001' },
    { enabled: true, relation: '母亲', name: '李秀兰', age: '53', company: '示例小学', position: '教师', politicalStatus: '群众', phone: '13900000002' },
  ],
  selfEvaluation: '扎实的计算机基础与后端开发经验，实习期间独立完成多个核心模块；学习能力强，抗压性好，乐于团队协作。',
  openAnswers: [],
  extras: [],
}

const SETTINGS = {
  apiBaseUrl: isReal ? REAL.base : 'http://localhost:8787/v1',
  apiKey: isReal ? REAL.key : 'test-key',
  model: isReal ? REAL.model : 'mock-model',
  privacyMode: 'with-values',
  autoPager: false,
}

// ---------- 启动（后台浏览器，不抢焦点） ----------
const { ctx, cleanup } = await launchExtensionBrowser(PROFILE_DIR)

const failures = []
const ok = (name, cond, extra = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures.push(name)
}

let mockServer = null
try {
  if (!isReal) {
    mockServer = await startMockLlm()
    console.log('mock LLM: http://localhost:8787/v1')
  } else {
    console.log(`真实 API 模式：${REAL.base} · ${REAL.model}`)
  }

  // 扩展 ID = SHA-256(dist 路径, utf8) 前 32 位映射 a-p；编码不确定时双候选试开
  const { createHash } = await import('node:crypto')
  const candidates = ['utf8', 'utf16le'].map((enc) =>
    Array.from(createHash('sha256').update(DIST, enc).digest('hex').slice(0, 32))
      .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(''),
  )
  const opt = await ctx.newPage()
  let extId = null
  for (const id of candidates) {
    try {
      await opt.goto(`chrome-extension://${id}/src/options/options.html`, { timeout: 4000 })
      extId = id
      break
    } catch { /* 换下一个候选 */ }
  }
  if (!extId) throw new Error('扩展未加载或 ID 推导失败')
  console.log(`扩展已加载，ID = ${extId}`)

  // 种入测试档案 + API 设置（必须等 ensureProfile 完成后再写，否则会被其空档案覆盖）
  await opt.waitForSelector('.toolbar select option', { timeout: 10000, state: 'attached' })
  await opt.evaluate(async (payload) => {
    await chrome.storage.local.set({ 'rs.profiles': [payload.profile], 'rs.activeProfileId': payload.profile.id, 'rs.settings': payload.settings })
  }, { profile: TEST_PROFILE, settings: SETTINGS })
  console.log('测试档案与 API 设置已种入')

  // 打开本地银行 mock 表单
  const page = await ctx.newPage()
  await page.goto(FIXTURE, { waitUntil: 'load' })

  const sendToFixture = (type, url = FIXTURE) => opt.evaluate(async ({ url, type }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    for (let i = 0; i < 15; i++) {
      try {
        const tabs = await chrome.tabs.query({})
        const tab = tabs.find((t) => (t.url ?? '').startsWith(url))
        if (!tab?.id) throw new Error('找不到目标标签页')
        return await chrome.tabs.sendMessage(tab.id, { type })
      } catch (e) {
        if (i === 14) throw e
        await sleep(400)
      }
    }
  }, { url, type })

  // ============ 阶段一：规则填写 + LLM 兜底 ============
  console.log('\n—— 阶段一：规则填写 ——')
  const scan = await sendToFixture('CONTENT_SCAN')
  console.log(`扫描到 ${scan.groups.length} 个分区：`)
  for (const g of scan.groups) console.log(`  · [${g.sectionKey}] ${g.sectionHint || g.sectionKey}（${g.fieldCount} 字段${g.hasAddButton ? '，含添加按钮' : ''}）`)
  ok('扫描识别基本信息分区', scan.groups.some((g) => g.sectionKey === 'basic'))
  ok('扫描识别教育经历分区', scan.groups.some((g) => g.sectionKey === 'educations'))

  const summary = await sendToFixture('CONTENT_FILL')
  console.log(`填写结果：✅已填 ${summary.filled}  🟠待确认 ${summary.review}  ❌失败 ${summary.failed}  未匹配 ${summary.unmatched}  需手动 ${summary.manual}`)
  for (const it of summary.items.filter((i) => i.status !== 'filled').slice(0, 12)) {
    console.log(`    ${it.status === 'failed' ? '❌' : '🟠'} [${it.via}] ${it.label}：${it.error ?? it.reason}`)
  }
  ok('填写成功数 ≥ 30', summary.filled >= 30, `实际 ${summary.filled}`)
  ok('失败数 == 0', summary.failed === 0, `实际 ${summary.failed}`)

  const v = await page.evaluate(() => {
    const q = (sel) => document.querySelector(sel)
    const val = (sel) => q(sel)?.value ?? null
    const text = (sel) => q(sel)?.selectedOptions?.[0]?.text ?? null
    const slots = (sel) => Array.from(document.querySelectorAll(sel))
    return {
      name: val('#f_name'),
      genderMale: q('input[name=gender][value="1"]')?.checked ?? false,
      birth: val('#f_birth'),
      nation: text('#f_nation'),
      political: text('#f_pol'),
      phone: val('#f_phone'),
      unmarried: q('input[name=marital][value="0"]')?.checked ?? false,
      eduSlots: slots('.edu-slot').length,
      edu0School: q('.edu-slot:nth-of-type(1) .edu_school')?.value ?? null,
      edu0Edu: q('.edu-slot:nth-of-type(1) .edu_edu')?.selectedOptions?.[0]?.text ?? null,
      edu1School: q('.edu-slot:nth-of-type(2) .edu_school')?.value ?? null,
      edu1Edu: q('.edu-slot:nth-of-type(2) .edu_edu')?.selectedOptions?.[0]?.text ?? null,
      edu1Start: q('.edu-slot:nth-of-type(2) .edu_start')?.value ?? null,
      internCompany: val('.it_company'),
      internTitle: val('.it_title'),
      internDesc: val('.it_desc'),
      projName: val('.pj_name'),
      projStack: val('.pj_stack'),
      projDesc: val('.pj_desc'),
      paperTitle: val('.pp_title'),
      paperVenue: val('.pp_venue'),
      paperOrder: document.querySelector('.pp_order')?.selectedOptions?.[0]?.text ?? null,
      paperDesc: val('.pp_desc'),
      familySlots: slots('.family-slot').length,
      fam1Rel: q('.family-slot:nth-of-type(2) .fm_rel')?.selectedOptions?.[0]?.text ?? null,
      fam1Name: q('.family-slot:nth-of-type(2) .fm_name')?.value ?? null,
      awardName: val('.aw_name'),
      awardLevel: document.querySelector('.aw_level')?.selectedOptions?.[0]?.text ?? null,
      awardSlots: slots('.award-slot').length,
      langCert: text('#lang_cert'),
      langScore: val('#lang_score'),
      intentCity: val('#in_city'),
      intentSalary: val('#in_salary'),
      selfEval: val('#self_eval'),
      openQ: val('#oq_why'),
      growth: val('#f_growth'),
      jgCas: document.querySelector('#f_jg_cas input')?.value ?? '',
      hkCas: document.querySelector('#f_hk_cas input')?.value ?? '',
      cityCas: document.querySelector('#f_city_cas input')?.value ?? '',
      panel: !!q('[data-rs-panel]'),
      greenCount: document.querySelectorAll('[data-rs-filled]').length,
    }
  })

  ok('基本信息·姓名', v.name === '张三丰', v.name ?? '')
  ok('基本信息·性别 radio', v.genderMale)
  ok('基本信息·出生日期(date 控件)', v.birth === '2001-03-15', v.birth ?? '')
  ok('基本信息·民族 select', v.nation === '汉族', v.nation ?? '')
  ok('基本信息·政治面貌 select', v.political === '共青团员', v.political ?? '')
  ok('基本信息·手机', v.phone === '13800001234', v.phone ?? '')
  ok('基本信息·婚姻状况 radio', v.unmarried)
  ok('籍贯·省级联下拉', v.jgCas === '广东省 / 广州市', v.jgCas)
  ok('户籍·省级联下拉', v.hkCas === '广东省 / 广州市', v.hkCas)
  ok('居住地·省级联下拉', v.cityCas === '浙江省 / 杭州市', v.cityCas)
  ok('教育·从零自动点添加（0→2槽）', v.eduSlots === 2, `槽位 ${v.eduSlots}`)
  ok('教育·槽1 本科院校', v.edu0School === '示例理工大学' && v.edu0Edu === '本科', `${v.edu0School}/${v.edu0Edu}`)
  ok('教育·槽2 硕士院校', v.edu1School === '示例大学' && v.edu1Edu === '硕士研究生', `${v.edu1School}/${v.edu1Edu}`)
  ok('教育·槽2 开始时间(month 控件)', v.edu1Start === '2022-09', v.edu1Start ?? '')
  ok('实习·公司/岗位/描述', v.internCompany === '示例科技有限公司' && v.internTitle === '后端开发实习生' && v.internDesc.includes('40%'), `${v.internCompany}/${v.internTitle}`)
  ok('项目·名称/技术栈/描述', v.projName === '校园二手书交易平台' && v.projStack === 'Python、FastAPI、MySQL' && v.projDesc.includes('千单'), `${v.projName}/${v.projStack}`)
  ok('论文·题目/期刊/作者排序', v.paperTitle === '分布式场景下的参数调优框架' && v.paperVenue === 'IEEE TPDS' && v.paperOrder === '第一作者', `${v.paperTitle}/${v.paperOrder}`)
  ok('论文·论文介绍（description）', (v.paperDesc ?? '').includes('吞吐'), (v.paperDesc ?? '').slice(0, 30))
  ok('家庭·从零自动点添加（0→2）', v.familySlots === 2, `槽位 ${v.familySlots}`)
  ok('家庭·槽2 关系/姓名', v.fam1Rel === '母亲' && v.fam1Name === '李秀兰', `${v.fam1Rel}/${v.fam1Name}`)
  ok('奖惩·从零添加+奖项/级别', v.awardSlots === 1 && v.awardName === '国家奖学金' && v.awardLevel === '国家级', `${v.awardSlots}槽/${v.awardName}`)
  ok('语言·CET-6/分数', v.langCert === 'CET-6' && v.langScore === '580', `${v.langCert}/${v.langScore}`)
  ok('意向·期望城市', v.intentCity === '杭州市、深圳市', v.intentCity ?? '')
  ok('意向·薪资区间拼装', v.intentSalary === '20-30', v.intentSalary ?? '')
  ok('自我评价', v.selfEval.includes('扎实的计算机基础'), (v.selfEval ?? '').slice(0, 20))
  ok('开放题保持为空（无答案不瞎填）', v.openQ === '', (v.openQ ?? '').slice(0, 20))
  ok('LLM 兜底·「成长故乡」映射籍贯', v.growth === '广东省 广州市', v.growth ?? '')
  ok('LLM 兜底计入结果（via=llm）', summary.items.some((i) => i.via === 'llm' && i.status !== 'failed'))
  ok('侧栏面板已注入', v.panel)
  ok('页面字段带高亮标记', v.greenCount >= 30, `标记 ${v.greenCount} 个`)

  // ============ 阶段二：文档导入 ============
  console.log('\n—— 阶段二：文档导入 ——')
  await opt.bringToFront()
  await opt.click('nav button:has-text("文档导入")')
  const docxPath = path.join(ROOT, 'e2e', 'sample-resume.docx')
  await opt.setInputFiles('#rs-import-file', docxPath)
  await opt.waitForSelector('#rs-import-text', { timeout: 15000 })
  const docxText = (await opt.textContent('#rs-import-text')) ?? ''
  ok('DOCX 本地解析出中文文本', docxText.includes('张三丰') && docxText.includes('示例大学'), `长度 ${docxText.length}`)

  await opt.click('#rs-extract-btn')
  await opt.waitForSelector('#rs-import-save', { timeout: 120000 })
  const saveLabel = (await opt.textContent('#rs-import-save')) ?? ''
  ok('LLM 抽取进入校对阶段', saveLabel.includes('另存为新档案'), saveLabel.trim().slice(0, 40))

  await opt.click('#rs-import-save')
  await opt.waitForFunction(() => {
    const t = document.querySelector('.toast')?.textContent ?? ''
    return t.includes('已保存')
  }, { timeout: 10000 })
  const imported = await opt.evaluate(async () => {
    const o = await chrome.storage.local.get(['rs.profiles', 'rs.activeProfileId'])
    const active = (o['rs.profiles'] ?? []).find((p) => p.id === o.rsActiveProfileId || p.id === o['rs.activeProfileId'])
    return { count: (o['rs.profiles'] ?? []).length, activeId: o['rs.activeProfileId'], active }
  })
  const ip = imported.active
  ok('导入档案已保存并设为当前', imported.count === 2 && !!ip, `档案数 ${imported.count}`)
  if (ip) {
    const loose = (cond) => cond // 真实 API 下字段覆盖面有波动，断言放宽
    ok('抽取·姓名', ip.basic?.name === '张三丰', ip.basic?.name ?? '')
    ok('抽取·教育经历 ≥ 1 条', Array.isArray(ip.educations) && ip.educations.length >= 1, `${ip.educations?.length ?? 0} 条`)
    ok('抽取·硕士学位识别', loose(JSON.stringify(ip.educations ?? []).includes('硕士')), '')
    ok('抽取·实习经历', loose(JSON.stringify(ip.experiences ?? []).includes('示例科技')), `${ip.experiences?.length ?? 0} 条`)
    ok('抽取·家庭成员 ≥ 1', loose(Array.isArray(ip.familyMembers) && ip.familyMembers.length >= 1), `${ip.familyMembers?.length ?? 0} 位`)
    ok('抽取·自我评价', loose((ip.selfEvaluation ?? '').length > 10), `${(ip.selfEvaluation ?? '').length} 字`)
  }

  // 用导入档案再填一轮（关键值回归）
  const summary2 = await sendToFixture('CONTENT_FILL')
  const after2 = await page.evaluate(() => ({
    name: document.querySelector('#f_name')?.value,
    selfEval: document.querySelector('#self_eval')?.value ?? '',
  }))
  ok('导入档案可直接用于填写', after2.name === '张三丰' && summary2.filled >= 20, `已填 ${summary2.filled}，姓名 ${after2.name}`)
  ok('itSkills→自我评价 硬兜底派生', after2.selfEval === '专业技能：Python、Go', after2.selfEval.slice(0, 24))

  // 回归：手动编辑自我评价不能存成对象（历史 bug：填写出 [object Object] 并令面板渲染崩溃）
  await opt.bringToFront()
  await opt.click('nav button:has-text("简历档案")')
  await opt.fill('[data-sect=selfEvaluation] textarea', '手工编辑的自我评价：抗压、学习快。')
  await opt.click('button:has-text("保存档案")')
  await opt.waitForFunction(() => (document.querySelector('.toast')?.textContent ?? '').includes('已保存'), { timeout: 8000 })
  await sendToFixture('CONTENT_FILL')
  const selfEval3 = await page.evaluate(() => document.querySelector('#self_eval')?.value ?? '')
  ok('手动编辑自我评价正常填写', selfEval3 === '手工编辑的自我评价：抗压、学习快。', selfEval3.slice(0, 24))

  // ============ 阶段三：组件适配器（Moka 风格页）============
  console.log('\n—— 阶段三：Moka 风格组件页 ——')
  const MOKA = 'http://localhost:8000/moka-form.html'
  const moka = await ctx.newPage()
  await moka.goto(MOKA, { waitUntil: 'load' })
  const mokaSummary = await sendToFixture('CONTENT_FILL', MOKA)
  console.log(`Moka页填写：✅${mokaSummary.filled}  🟠${mokaSummary.review}  ❌${mokaSummary.failed}`)
  for (const it of mokaSummary.items.filter((i) => i.status !== 'filled').slice(0, 6)) {
    console.log(`    ${it.status === 'failed' ? '❌' : '🟠'} [${it.via}] ${it.label}：${(it.error ?? it.reason).slice(0, 60)}`)
  }
  const mv = await moka.evaluate(() => ({
    name: document.querySelector('#mk_name')?.value,
    edu: document.querySelector('#mk_edu .ant-select-selection-item')?.textContent,
    degree: document.querySelector('#mk_degree_text')?.textContent,
    native: document.querySelector('#mk_native input')?.value,
    date: document.querySelector('#mk_date_input')?.value,
    projDesc: document.querySelector('#mk_proj_desc')?.textContent ?? '',
    self: document.querySelector('#mk_self')?.value ?? '',
  }))
  ok('Moka·原生姓名', mv.name === '张三丰', mv.name ?? '')
  ok('Moka·antd 自定义下拉（学历）', mv.edu === '本科', mv.edu ?? '')
  ok('Moka·Element 自定义下拉（学位）', mv.degree === '学士', mv.degree ?? '')
  ok('Moka·级联选择器（省/市）', mv.native === '广东省 / 广州市', mv.native ?? '')
  ok('Moka·自定义日期（ant-picker）', mv.date === '2018-09', mv.date ?? '')
  ok('Moka·富文本（Quill）', mv.projDesc.includes('千单'), mv.projDesc.slice(0, 24))
  ok('Moka·自我评价', mv.self.includes('手工编辑'), mv.self.slice(0, 20))
  ok('Moka·失败数为 0', mokaSummary.failed === 0, `实际 ${mokaSummary.failed}`)
  await moka.screenshot({ path: path.join(ROOT, 'e2e', 'after-moka.png'), fullPage: true })
  await moka.close()

  // ============ 阶段三b：知乎 Moka 简历页结构复刻 ============
  // 覆盖：侧边导航不劫持分区 / 搜索式下拉（学校/专业/学历）/ 区间日期 + 至今复选 /
  //       默认空卡+点添加 / 项目经验多卡（论文降级合并）/ LLM 全量复审（补填+纠错）
  console.log('\n—— 阶段三b：知乎简历页结构复刻 ——')
  const ZHIHU = 'http://localhost:8000/moka-resume.html'
  const zh = await ctx.newPage()
  await zh.goto(ZHIHU, { waitUntil: 'load' })
  const zhScan = await sendToFixture('CONTENT_SCAN', ZHIHU)
  console.log(`扫描到 ${zhScan.groups.length} 个分区：${zhScan.groups.map((g) => g.sectionKey).join('，')}`)
  ok('侧边导航未劫持分区（≥6 个分区）', zhScan.groups.length >= 6, `${zhScan.groups.length} 个`)
  ok('识别「自我描述」分区', zhScan.groups.some((g) => g.sectionKey === 'selfEvaluation'))
  ok('识别「项目经验」分区', zhScan.groups.some((g) => g.sectionKey === 'projects'))

  const zhSummary = await sendToFixture('CONTENT_FILL', ZHIHU)
  console.log(`知乎页填写：✅${zhSummary.filled}  🟠${zhSummary.review}  ❌${zhSummary.failed}`)
  for (const it of zhSummary.items.filter((i) => i.status !== 'filled').slice(0, 8)) {
    console.log(`    ${it.status === 'failed' ? '❌' : '🟠'} [${it.via}] ${it.label || '（无标签）'}：${(it.error ?? it.reason).slice(0, 60)}`)
  }
  const zv = await zh.evaluate(() => {
    const edu = document.querySelectorAll('.edu-card')
    const proj = document.querySelectorAll('.proj-card')
    return {
      name: document.querySelector('#mr_name')?.value ?? '',
      growth: document.querySelector('#mr_growth')?.value ?? '',
      eduCount: edu.length,
      edu1School: edu[0]?.querySelector('.edu_school')?.value ?? '',
      edu1Major: edu[0]?.querySelector('.edu_major')?.value ?? '',
      edu1Edu: edu[0]?.querySelector('.edu_edu .ant-select-selection-item')?.textContent ?? '',
      edu1Start: edu[0]?.querySelector('.edu_start')?.value ?? '',
      edu1End: edu[0]?.querySelector('.edu_end')?.value ?? '',
      edu2School: edu[1]?.querySelector('.edu_school')?.value ?? '',
      edu2Major: edu[1]?.querySelector('.edu_major')?.value ?? '',
      edu2Edu: edu[1]?.querySelector('.edu_edu .ant-select-selection-item')?.textContent ?? '',
      edu2Start: edu[1]?.querySelector('.edu_start')?.value ?? '',
      edu2Now: edu[1]?.querySelector('.edu_now')?.checked ?? false,
      projCount: proj.length,
      proj1Name: proj[0]?.querySelector('.pj_name')?.value ?? '',
      proj1Duty: proj[0]?.querySelector('.pj_duty')?.value ?? '',
      proj1Desc: proj[0]?.querySelector('.pj_desc')?.value ?? '',
      proj1Start: proj[0]?.querySelector('.pj_start')?.value ?? '',
      proj2Name: proj[1]?.querySelector('.pj_name')?.value ?? '',
      proj2Duty: proj[1]?.querySelector('.pj_duty')?.value ?? '',
      proj2Desc: proj[1]?.querySelector('.pj_desc')?.value ?? '',
      awardName: document.querySelector('.award-card .aw_name')?.value ?? '',
      awardDate: document.querySelector('.award-card .aw_date')?.value ?? '',
      langSel: document.querySelector('.lang_lang .ant-select-selection-item')?.textContent ?? '',
      cert: document.querySelector('#mr_cert')?.value ?? '',
      self: document.querySelector('#mr_self')?.value ?? '',
    }
  })
  ok('个人信息·姓名', zv.name === '张三丰', zv.name)
  ok('LLM 补填·成长故乡→籍贯', zv.growth === '广东省 广州市', zv.growth)
  ok('教育·点添加出第2张卡', zv.eduCount === 2, `${zv.eduCount} 卡`)
  ok('教育·卡1 搜索下拉学校', zv.edu1School === '示例理工大学', zv.edu1School)
  ok('教育·卡1 搜索下拉专业', zv.edu1Major === '计算机科学与技术', zv.edu1Major)
  ok('教育·卡1 远程搜索下拉学历', zv.edu1Edu === '本科', zv.edu1Edu)
  ok('教育·卡1 区间日期起止', zv.edu1Start === '2018-09' && zv.edu1End === '2022-06', `${zv.edu1Start}~${zv.edu1End}`)
  ok('教育·卡2 学校/专业/学历', zv.edu2School === '示例大学' && zv.edu2Major === '软件工程' && zv.edu2Edu === '硕士研究生', `${zv.edu2School}/${zv.edu2Major}/${zv.edu2Edu}`)
  ok('教育·卡2 至今复选框勾选', zv.edu2Now && zv.edu2Start === '2022-09', `start=${zv.edu2Start} 至今=${zv.edu2Now}`)
  ok('项目·论文降级合并出第2卡', zv.projCount === 2, `${zv.projCount} 卡`)
  ok('项目·卡1 名称/描述/起止', zv.proj1Name === '校园二手书交易平台' && zv.proj1Desc.includes('千单') && zv.proj1Start === '2023-03', `${zv.proj1Name}/${zv.proj1Start}`)
  ok('LLM 纠正·职责→项目描述', zv.proj1Duty.includes('从 0 到 1'), zv.proj1Duty.slice(0, 20))
  ok('项目·卡2 论文题目+介绍', zv.proj2Name === '分布式场景下的参数调优框架' && zv.proj2Desc.includes('吞吐') && zv.proj2Duty.includes('吞吐'), zv.proj2Name)
  ok('获奖·名称+单值日期', zv.awardName === '国家奖学金' && zv.awardDate === '2023-10', `${zv.awardName}/${zv.awardDate}`)
  ok('语言·语种下拉+证书', zv.langSel === '英语' && zv.cert === 'CET-6', `${zv.langSel}/${zv.cert}`)
  ok('自我描述填写', zv.self === '手工编辑的自我评价：抗压、学习快。', zv.self.slice(0, 20))
  ok('LLM 复审计入结果（fill+fix）',
    zhSummary.items.some((i) => i.via === 'llm' && i.reason.startsWith('LLM 补填'))
    && zhSummary.items.some((i) => i.via === 'llm' && i.reason.startsWith('LLM 纠正')))
  ok('知乎页失败数为 0', zhSummary.failed === 0, `实际 ${zhSummary.failed}`)
  await zh.screenshot({ path: path.join(ROOT, 'e2e', 'after-moka-resume.png'), fullPage: true })
  await zh.close()

  // PDF 文本链路（英文样例，验证 pdf.js 接线）
  await opt.bringToFront()
  await opt.click('nav button:has-text("文档导入")')
  await opt.setInputFiles('#rs-import-file', path.join(ROOT, 'e2e', 'sample-resume-en.pdf'))
  await opt.waitForFunction(() => (document.querySelector('#rs-import-text')?.textContent ?? '').includes('Zhang'), { timeout: 20000 })
  ok('PDF 本地解析出文本层', true)

  await page.bringToFront()
  await page.screenshot({ path: path.join(ROOT, 'e2e', 'after-fill.png'), fullPage: true })
  console.log('截图：e2e/after-fill.png')
} finally {
  await cleanup()
  mockServer?.close?.()
}

console.log(failures.length === 0 ? '\n🎉 全部断言通过' : `\n💥 ${failures.length} 项失败：${failures.join('、')}`)
process.exit(failures.length === 0 ? 0 : 1)
