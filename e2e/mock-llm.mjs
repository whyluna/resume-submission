/**
 * 本地 mock OpenAI 兼容服务（端口 8787），供 E2E 确定性回归：
 * - prompt 含「任务A：简历结构化抽取」→ 返回固定档案 JSON
 * - prompt 含「任务B：字段映射」→ 返回固定映射（成长故乡 → basic.nativePlace）
 */
import http from 'node:http'

const EXTRACT = {
  basic: {
    name: '张三丰', gender: '男', birthDate: '2001-03-15', nation: '汉族',
    politicalStatus: '共青团员', idType: '身份证', idNumber: '', phone: '13800001234',
    email: 'zsf@example.com', nativePlace: '广东省 广州市', hukou: '广东省 广州市',
    currentCity: '浙江省 杭州市', height: '178', maritalStatus: '未婚', homepage: 'https://github.com/zsf',
  },
  intention: { cities: ['杭州市', '深圳市'], positions: ['后端开发工程师'], salaryMin: '20', salaryMax: '30' },
  educations: [
    { enabled: true, school: '示例理工大学', college: '', major: '计算机科学与技术', education: '本科', degree: '学士', startDate: '2018-09', endDate: '2022-06', gpa: '3.6', rankPercent: '前15%', courses: '数据结构、操作系统、计算机网络' },
    { enabled: true, school: '示例大学', college: '计算机学院', major: '软件工程', education: '硕士研究生', degree: '硕士', startDate: '2022-09', endDate: '至今', gpa: '3.8', rankPercent: '前10%' },
  ],
  experiences: [
    { enabled: true, kind: 'internship', company: '示例科技有限公司', department: '基础架构部', title: '后端开发实习生', startDate: '2024-06', endDate: '2024-12', description: '负责内部平台的接口开发与性能优化，将核心查询耗时降低 40%。' },
  ],
  projects: [
    { enabled: true, name: '校园二手书交易平台', role: '后端负责人', startDate: '2023-03', endDate: '2023-09', description: '从 0 到 1 搭建交易平台后端，支撑日均千单。', techStack: ['Python', 'FastAPI', 'MySQL'] },
  ],
  papers: [
    { enabled: true, title: '分布式场景下的参数调优框架', venue: 'IEEE TPDS', publishDate: '2025-06', authorOrder: '第一作者', indexed: 'CCF-A', description: '提出分布式训练参数调优框架，实测训练吞吐提升 30%，代码已开源。' },
  ],
  awards: [{ enabled: true, name: '国家奖学金', level: '国家级', date: '2023-10' }],
  languages: [{ enabled: true, language: '英语', certificate: 'CET-6', score: '580', date: '2020-12' }],
  familyMembers: [
    { enabled: true, relation: '父亲', name: '张大山', company: '个体经营', position: '经营者', phone: '13900000001' },
    { enabled: true, relation: '母亲', name: '李秀兰', company: '示例小学', position: '教师', phone: '13900000002' },
  ],
  // 故意不含 selfEvaluation：验证 itSkills → 自我评价 的硬兜底派生
  itSkills: [{ skill: 'Python' }, { skill: 'Go' }],
}

/**
 * 任务B2（字段复审）的确定性应答：从 prompt 里的 fields JSON 动态取编号。
 * - 「成长故乡」→ 补填 basic.nativePlace（op:fill，验证规则层漏配的语义映射）
 * - 项目分区里的「职责」→ 纠正为 projects[0].description（op:fix，验证规则层错配可被纠正）
 */
function buildReviewPlan(prompt) {
  const plan = []
  try {
    const m = prompt.match(/\n(\[\{.*?\}\])\n/s)
    const fields = m ? JSON.parse(m[1]) : []
    const growth = fields.find((f) => f.label === '成长故乡')
    if (growth) plan.push({ i: growth.i, op: 'fill', path: 'basic.nativePlace', c: 0.85, why: '成长故乡即籍贯' })
    const duties = fields.filter((f) => f.label === '职责' && String(f.section ?? '').includes('项目'))
    for (const duty of duties) {
      const slot = /第(\d+)条/.exec(String(duty.section ?? ''))?.[1] ?? '1'
      plan.push({ i: duty.i, op: 'fix', path: `projects[${Number(slot) - 1}].description`, c: 0.8, why: '职责应为项目描述' })
    }
  } catch { /* 解析失败返回空计划 */ }
  return plan
}

function buildV2Plan(prompt) {
  const payload = JSON.parse(prompt)
  return (payload.batch?.fields ?? []).flatMap((field) => {
    if (field.label === '职责' && Number.isInteger(field.entryIndex)) return [{
      fieldId: field.fieldId,
      decision: 'replace-rule',
      profilePaths: [`projects[${field.entryIndex}].description`],
      transform: 'identity',
      confidence: 0.9,
      reason: '职责使用项目描述',
    }]
    const rule = field.ruleCandidates?.[0]
    if (rule) return [{
      fieldId: field.fieldId,
      decision: 'keep-rule',
      profilePaths: [rule.profilePath],
      transform: rule.transform,
      confidence: rule.score,
      reason: 'mock 保留规则',
    }]
    if (field.label?.includes('成长故乡')) return [{
      fieldId: field.fieldId,
      decision: 'fill',
      profilePaths: ['basic.nativePlace'],
      transform: 'identity',
      confidence: 0.9,
      reason: '成长故乡即籍贯',
    }]
    return []
  })
}

function buildAgentToolPlan(prompt) {
  const payload = JSON.parse(prompt)
  return {
    calls: (payload.fields ?? []).map((field, index) => {
      if (field.existingState === 'non-empty') return {
        callId: `skip_${index}`, tool: 'mark_skip', reason: '已有值', args: { fieldId: field.fieldId, reason: '已有值不覆盖' },
      }
      const rule = field.ruleHints?.[0]
      if (!rule) return {
        callId: `manual_${index}`, tool: 'mark_manual', reason: '没有事实', args: { fieldId: field.fieldId, reason: '没有可靠事实' },
      }
      if (field.capabilities?.includes('fill-date')) return {
        callId: `date_${index}`, tool: 'fill_date_from_facts', reason: '日期事实',
        args: { fieldId: field.fieldId, startFactId: rule.factId, requestedShape: 'auto' },
      }
      if (field.capabilities?.includes('select-option')) return {
        callId: `select_${index}`, tool: 'select_option_from_fact', reason: '选项事实',
        args: { fieldId: field.fieldId, factId: rule.factId, match: 'synonym' },
      }
      if (field.capabilities?.includes('write-text')) return {
        callId: `text_${index}`, tool: 'fill_text_from_fact', reason: '文本事实',
        args: { fieldId: field.fieldId, factIds: [rule.factId], transform: 'identity' },
      }
      return {
        callId: `manual_${index}`, tool: 'mark_manual', reason: '不支持的控件', args: { fieldId: field.fieldId, reason: '不支持的控件' },
      }
    }),
  }
}

function buildOneShotSemanticPlan(prompt) {
  const payload = JSON.parse(prompt)
  const fields = payload.form?.fields ?? []
  return {
    plan: fields.map((field) => {
      if (field.existingState === 'non-empty' || field.existingState === 'locked') return {
        fieldId: field.fieldId, decision: 'skip', profilePaths: [], transform: 'identity', confidence: 1, reason: '已有值或锁定',
      }
      if (field.labels?.some((label) => label === '职责') && field.entryRoute?.factPrefix?.startsWith('projects[')) return {
        fieldId: field.fieldId, decision: 'replace-rule', profilePaths: [`${field.entryRoute.factPrefix}.description`],
        transform: 'identity', confidence: 0.9, reason: '职责使用项目描述',
      }
      if (field.labels?.some((label) => label.includes('成长故乡'))) return {
        fieldId: field.fieldId, decision: 'fill', profilePaths: ['basic.nativePlace'],
        transform: 'identity', confidence: 0.9, reason: '成长故乡即籍贯',
      }
      const rule = field.ruleHints?.[0]
      if (rule) return {
        fieldId: field.fieldId, decision: 'keep-rule', profilePaths: [rule.path],
        transform: field.allowedTransforms?.includes(rule.transform) ? rule.transform : (field.allowedTransforms?.[0] ?? 'identity'),
        confidence: rule.confidence, reason: 'mock 全量复审保留规则',
      }
      return {
        fieldId: field.fieldId, decision: 'manual', profilePaths: [], transform: 'identity', confidence: 1, reason: '没有可靠事实',
      }
    }),
  }
}

export function startMockLlm(port = 8787) {
  const server = http.createServer((req, res) => {
    if (!req.url?.includes('/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let content = 'ok'
      try {
        const parsed = JSON.parse(body)
        const last = parsed.messages?.at(-1)?.content ?? ''
        if (last.includes('"task":"review-all-fields-once"')) content = JSON.stringify(buildOneShotSemanticPlan(last))
        else if (last.includes('"mode":"agent-tool-round"') || last.includes('"mode":"agent-repair-round"')) content = JSON.stringify(buildAgentToolPlan(last))
        else if (last.includes('"task":"review-all-fields-in-section"')) content = JSON.stringify(buildV2Plan(last))
        else if (last.includes('任务A')) content = JSON.stringify(EXTRACT)
        else if (last.includes('任务B')) content = JSON.stringify(buildReviewPlan(last))
      } catch { /* 默认 ok */ }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'mock', object: 'chat.completion', model: 'mock',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      }))
    })
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

// 直接运行时作为独立服务
if (process.argv[1]?.endsWith('mock-llm.mjs')) {
  startMockLlm().then(() => console.log('mock LLM on http://localhost:8787/v1'))
}
