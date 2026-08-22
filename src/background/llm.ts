import type { LlmMatchFieldIn, LlmMatchItem, Profile, Settings } from '@/shared/types'
import { SECTIONS, SECTION_BY_KEY } from '@/shared/profileSchema'
import { getSettings } from '@/shared/storage'
import { normalizeProfileDates } from '@/shared/dateValues'

const TIMEOUT_MS = 150_000

interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }

/** OpenAI 兼容 chat completion（所有 LLM 调用唯一出口；API key 不离开 background） */
export async function chat(settings: Settings, messages: ChatMsg[], opts: { maxTokens?: number; temperature?: number; timeoutMs?: number; jsonMode?: boolean } = {}): Promise<string> {
  const base = settings.apiBaseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
  const maxTokens = opts.maxTokens ?? 32000 // 推理模型会把大量 token 花在思考上，预算留足冗余
  const doFetch = async (tokens: number, jsonMode = opts.jsonMode === true) => {
    const ctrl = new AbortController()
    const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({
          model: settings.model,
          messages,
          temperature: opts.temperature ?? 0,
          max_tokens: tokens,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { ok: false as const, status: res.status, body }
      }
      const data = await res.json()
      const choice = data?.choices?.[0]
      // 推理模型偶尔把全部输出留在 reasoning_content 而 content 为空（finish_reason=stop）
      const content: string = choice?.message?.content || choice?.message?.reasoning_content || ''
      if (!content) {
        return { ok: false as const, status: 0, body: `模型返回空内容（finish_reason=${choice?.finish_reason ?? 'unknown'}，可尝试调大 max_tokens）` }
      }
      return { ok: true as const, content }
    } catch (error) {
      if (ctrl.signal.aborted) throw new Error(`模型请求超过 ${Math.round(timeoutMs / 1000)} 秒，已安全取消；页面未继续执行`)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  let r = await doFetch(maxTokens)
  if (!r.ok && r.status === 400 && opts.jsonMode && /response_format|json_object|json mode/i.test(r.body)) {
    r = await doFetch(maxTokens, false)
  }
  // 个别 API 对 max_tokens 设上限，超限报 400 时自动降档重试一次
  if (!r.ok && r.status === 400 && /max_tokens/i.test(r.body) && maxTokens > 8192) {
    r = await doFetch(8192)
  }
  if (!r.ok) throw new Error(r.body ? `HTTP ${r.status}：${r.body.slice(0, 200)}` : r.body || '请求失败')
  return r.content
}

/** 从模型输出中抠出 JSON（容忍 markdown 围栏、前后说明文字、尾逗号） */
export function parseJsonLoose<T>(raw: string): T {
  const sources = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim())
  sources.push(raw.trim())
  let lastError: unknown = new Error('模型输出中没有 JSON')
  const tryParse = (text: string): T | undefined => {
    for (const candidate of [text, text.replace(/,\s*([}\]])/g, '$1')]) {
      try { return JSON.parse(candidate) as T } catch (error) { lastError = error }
    }
    return undefined
  }
  for (const source of sources) {
    const direct = tryParse(source)
    if (direct !== undefined) return direct
    for (let start = 0; start < source.length; start++) {
      const opener = source[start]
      if (opener !== '{' && opener !== '[') continue
      const stack: string[] = []
      let quoted = false
      let escaped = false
      for (let index = start; index < source.length; index++) {
        const char = source[index]
        if (quoted) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') quoted = false
          continue
        }
        if (char === '"') { quoted = true; continue }
        if (char === '{' || char === '[') stack.push(char)
        else if (char === '}' || char === ']') {
          const expected = char === '}' ? '{' : '['
          if (stack.at(-1) !== expected) break
          stack.pop()
          if (stack.length === 0) {
            const parsed = tryParse(source.slice(start, index + 1))
            if (parsed !== undefined) return parsed
            break
          }
        }
      }
    }
  }
  throw lastError
}

// ---------------- 任务A：简历文本 → 结构化档案 ----------------

/** 由元数据生成 schema 提示（label 即语义说明） */
function schemaHint(): string {
  const part = (key: string) => {
    const def = SECTION_BY_KEY[key]
    const fields = def.fields.map((f) => `"${f.k}":"${f.label}"`).join(',')
    const ongoing = ['educations', 'experiences', 'projects', 'studentWork'].includes(key)
      ? ',"endDateIsNow":"是否至今/进行中(boolean)"'
      : ''
    return def.repeat ? `"${key}":[{"enabled":true,${fields}${ongoing}}]` : `"${key}":{${fields}}`
  }
  return `{\n  ${['basic', 'intention', 'educations', 'experiences', 'projects', 'papers', 'competitions', 'awards', 'studentWork', 'languages', 'certificates', 'familyMembers'].map(part).join(',\n  ')},\n  "selfEvaluation":"自我评价原文"\n}`
}

const EXTRACT_SYSTEM = '你是简历信息结构化抽取引擎。只输出严格 JSON，不要 markdown 围栏、不要解释。不确定或原文没有的字段填空字符串/空数组，绝不编造。数组条目必须至少有一个非空字段，全空的条目不要输出。日期原子统一 YYYY、YYYY-MM 或 YYYY-MM-DD；起止时间必须分别写入 startDate/endDate，不要输出拼接的日期区间；在读/在职/进行中的 endDate 写空字符串，并额外输出 endDateIsNow:true，不得把"至今"写进日期值。education=学历层次（本科/硕士研究生/博士研究生/专科），degree=学位（学士/硕士/博士），两者不要混淆。教育经历按时间从低到高排序；实习和工作经历都放 experiences（kind 字段区分 internship/fulltime）；论文/科研成果一律放 papers（description 填论文介绍/摘要/个人工作原文要点），不要把论文当成项目放进 projects。简历中的专业技能/技能清单（通常在简历末尾，形如"精通 Python，熟悉 PyTorch/Redis…"）：逐项拆到 itSkills（[{"skill":"Python"},{"skill":"PyTorch"}]），同时整理成连贯的一段话放入 selfEvaluation（若简历另有自我评价段落，则以自我评价优先）。'

export async function extractProfile(text: string): Promise<{ ok: boolean; draft?: Partial<Profile>; message: string }> {
  const settings = await getSettings()
  if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    return { ok: false, message: '请先在「API 与偏好」完成配置' }
  }
  const clipped = text.length > 14000 ? text.slice(0, 14000) : text
  try {
    const out = await chat(settings, [
      { role: 'system', content: EXTRACT_SYSTEM },
      {
        role: 'user',
        content: `【任务A：简历结构化抽取】
目标 JSON 结构（键名固定，引号内中文是该键的含义；数组分区每条都带这些键，缺的留空）：
${schemaHint()}

简历全文：
<<<
${clipped}
>>>

输出该 JSON。`,
      },
    ], { temperature: 0 })
    const parsed = parseJsonLoose<Record<string, unknown>>(out)
    const draft = sanitizeDraft(parsed)
    postProcessDraft(draft as Record<string, unknown>, parsed)
    normalizeProfileDates(draft)
    return { ok: true, draft, message: '抽取完成，请逐项校对' }
  } catch (e) {
    return { ok: false, message: `抽取失败：${(e as Error).message}` }
  }
}

/** 白名单清洗：只收已知键，类型矫正 */
function sanitizeDraft(raw: Record<string, unknown>): Partial<Profile> {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v))
  const clean: Record<string, unknown> = {}
  for (const def of SECTIONS) {
    if (def.repeat) {
      const arr = raw[def.key]
      if (Array.isArray(arr)) {
        clean[def.key] = arr.slice(0, 20).map((it) => {
          const item: Record<string, unknown> = { enabled: true }
          for (const f of def.fields) {
            const v = (it as Record<string, unknown>)[f.k]
            item[f.k] = f.list ? (Array.isArray(v) ? v.map(str).filter(Boolean) : v ? String(v).split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean) : []) : str(v)
          }
          if (['educations', 'experiences', 'projects', 'studentWork'].includes(def.key)) {
            const rawItem = it as Record<string, unknown>
            item.endDateIsNow = rawItem.endDateIsNow === true
              || String(rawItem.endDateIsNow).toLowerCase() === 'true'
              || /至今|现在|在读|进行中|仍在职/.test(str(rawItem.endDate))
          }
          return item
        }).filter((it) => def.fields.some((f) => { // 丢弃全空条目（模型偶尔生成占位条目）
          const v = it[f.k]
          return Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim() !== ''
        }))
      }
    } else {
      if (def.key === 'selfEvaluation') {
        // selfEvaluation 在 Profile 上是纯字符串；模型可能给串也可能给 {selfEvaluation: '...'}
        const raw2 = raw[def.key]
        clean.selfEvaluation = str(typeof raw2 === 'string' ? raw2 : (raw2 as Record<string, unknown> | undefined)?.selfEvaluation)
        continue
      }
      const obj = raw[def.key]
      if (obj && typeof obj === 'object') {
        const o: Record<string, unknown> = {}
        for (const f of def.fields) {
          const v = (obj as Record<string, unknown>)[f.k]
          o[f.k] = f.list ? (Array.isArray(v) ? v.map(str).filter(Boolean) : v ? String(v).split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean) : []) : str(v)
        }
        clean[def.key] = o
      }
    }
  }
  return clean as Partial<Profile>
}

/** 抽取后处理：捕获 itSkills，并在 selfEvaluation 为空时由技能清单生成（硬兜底，不依赖模型自觉） */
function postProcessDraft(clean: Record<string, unknown>, raw: Record<string, unknown>): void {
  const itRaw = raw.itSkills
  if (Array.isArray(itRaw)) {
    clean.itSkills = itRaw.slice(0, 30).map((x) => ({
      skill: typeof x === 'string' ? x.trim() : String((x as Record<string, unknown>)?.skill ?? '').trim(),
      level: 3 as const,
    })).filter((s) => s.skill)
  }
  const se = clean.selfEvaluation
  if ((!se || String(se).trim() === '') && Array.isArray(clean.itSkills) && clean.itSkills.length > 0) {
    clean.selfEvaluation = `专业技能：${(clean.itSkills as Array<{ skill: string }>).map((s) => s.skill).join('、')}`
  }
}

// ---------------- 任务B2：规则结果 + 未匹配字段 → LLM 全量复审 ----------------

const MATCH_SYSTEM = '你是表单字段语义映射引擎。只输出严格 JSON 数组，不要 markdown 围栏、不要解释。表单字段分两类：rule 为 null 的未被规则引擎映射（需要你补填），rule 非 null 的已被映射（仅在映射明显错误时纠正）。path 必须用给出的完整路径（含条目下标）；语义不合适就不输出（不要硬凑）。置信度 c 取 0~1 的一位小数。'

export async function matchFields(fields: LlmMatchFieldIn[], profileLines: string[]): Promise<{ ok: boolean; plan?: LlmMatchItem[]; message: string }> {
  const settings = await getSettings()
  if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    return { ok: false, message: '未配置 API' }
  }
  const unmatchedCount = fields.filter((f) => !f.rule).length
  try {
    const out = await chat(settings, [
      { role: 'system', content: MATCH_SYSTEM },
      {
        role: 'user',
        content: `【任务B2：字段复审】
规则引擎已完成第一轮匹配。表单字段（i 是编号；section 是所在分区；options 是可选项；rule 是规则引擎的映射结果与得分，rule 为 null 表示未匹配，*** 表示敏感值已掩码）：
${JSON.stringify(fields.slice(0, 60))}

简历可用字段（path: 含义=当前值）：
${profileLines.slice(0, 160).join('\n')}

请用语义理解复审：
1. 对 rule 为 null 的字段（共 ${unmatchedCount} 个）：若简历里有语义合适的字段，输出 {"i":编号,"op":"fill","path":"完整path","c":0.9,"why":"原因(≤15字)"}。注意字段所在分区和槽位（如"教育经历 第2条"应对应 educations[1]），label 是最准的信号，placeholder 其次。
2. 对 rule 非 null 的字段：若你认为映射错误（值放错了地方），输出 {"i":编号,"op":"fix","path":"正确path","c":0.85,"why":"原因"}；只在很有把握（c≥0.75）时纠正，正确的不用输出。
3. 值会从 path 在本地取得，不要编造值。输出 JSON 数组（没有可输出的就输出 []）。`,
      },
    ], { temperature: 0 })
    const plan = parseJsonLoose<LlmMatchItem[]>(out)
    if (!Array.isArray(plan)) throw new Error('返回不是数组')
    const valid = plan
      .filter((p) => Number.isInteger(p.i) && typeof p.path === 'string' && p.c > 0.3)
      .filter((p) => p.op === undefined || p.op === 'fill' || p.op === 'fix')
    const fills = valid.filter((p) => p.op !== 'fix').length
    const fixes = valid.length - fills
    return { ok: true, plan: valid, message: `LLM 复审：补填 ${fills}、纠正 ${fixes}` }
  } catch (e) {
    return { ok: false, message: `复审失败：${(e as Error).message}` }
  }
}
