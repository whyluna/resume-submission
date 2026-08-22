import type {
  BtnCandidate, ControlKind, FieldEl, FieldSignals, FormSnapshot, GroupEl, SectionKey,
} from '@/shared/types'
import { cssPath, hashSig, norm } from '@/shared/util'

/** 分区标题文本 → SectionKey（按顺序匹配，先具体后泛化） */
const SECTION_RULES: Array<[RegExp, SectionKey]> = [
  [/基本(信息|资料)|个人(信息|资料)/, 'basic'],
  [/求职(意向|意愿)|期望|意向(岗位|职位|城市)/, 'intention'],
  [/教育(背景|经历|信息)/, 'educations'],
  [/实习(经历|经验)/, 'experiences'],
  [/工作(经历|经验)/, 'experiences'],
  [/(科研|论文|学术|论文发表)/, 'papers'],
  [/项目(经历|经验)/, 'projects'],
  [/竞赛|比赛/, 'competitions'],
  [/奖惩|获奖|荣誉|奖励/, 'awards'],
  [/学生工作|社团|社会实践|校园经历|社会活动/, 'studentWork'],
  [/(语言|外语|英语)(能力)?/, 'languages'],
  [/计算机(能力|水平|技能)?|IT技能|专业技能|技能特长/, 'itSkills'],
  [/(资格)?证书/, 'certificates'],
  [/家庭(成员|情况|信息)|社会关系|亲属/, 'familyMembers'],
  [/自我(评价|介绍|描述)|个人(评价|优势|简介)/, 'selfEvaluation'],
  [/开放(性问题|问题|题)|问答|其他(信息|补充)|补充(说明|信息)/, 'openQuestions'],
]

function sectionKeyOf(text: string): SectionKey | null {
  const t = norm(text)
  if (!t || t.length > 30) return null
  for (const [re, key] of SECTION_RULES) {
    if (re.test(t)) return key
  }
  return null
}

/** repeat 分区：同一条目可能反复出现多条 */
const REPEAT_SECTIONS = new Set<SectionKey>([
  'educations', 'experiences', 'projects', 'papers', 'competitions', 'awards', 'studentWork', 'languages', 'certificates', 'familyMembers',
])

function isVisible(el: Element): boolean {
  const html = el as HTMLElement
  if (html.hidden) return false
  const rects = el.getClientRects()
  if (rects.length === 0) return false
  const style = getComputedStyle(html)
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
}

function controlKindOf(el: Element): ControlKind | null {
  if (el instanceof HTMLInputElement) {
    switch (el.type) {
      case 'text': case 'password': case 'email': case 'tel': case 'number': case 'search': case 'url':
        return 'text'
      case 'date': case 'month': case 'week': case 'datetime-local': case 'time':
        return 'date'
      case 'radio': return 'radio'
      case 'checkbox': return 'checkbox'
      case 'file': return 'upload'
      default: return null // hidden/submit/button 等
    }
  }
  if (el instanceof HTMLSelectElement) return 'select'
  if (el instanceof HTMLTextAreaElement) return 'textarea'
  if ((el as HTMLElement).isContentEditable) return 'richtext'
  return null
}

/**
 * 自定义组件识别：antd/Element/Arco/Moka 等组件库的输入框是只读 input + 包装层结构，
 * 浮层选项挂在 body。命中时以「包装层」为字段元素（内部 input 常常宽高为 0 或只读，
 * 不可见/不可直接写），控件类型改为 customselect / cascader / date。
 */
const CUSTOM_WRAP_HINT = /(^|\s|-)(ant-select|el-select|arco-select|ant-cascader|el-cascader|arco-cascader|ant-picker|el-date-editor|arco-picker|semi-select|n-select|t-select|moka-?select)([\s-]|$)|select-selector|select-selection/i

function customWrapperFor(el: Element): { el: Element; kind: ControlKind } | null {
  if (!(el instanceof HTMLInputElement) && !(el as HTMLElement).isContentEditable) return null
  const SEL = '[class*="ant-select"], [class*="el-select"], [class*="arco-select"], [class*="ant-cascader"], [class*="el-cascader"], [class*="arco-cascader"], [class*="ant-picker"], [class*="el-date-editor"], [class*="arco-picker"], [class*="moka-select"]'
  let wrap: HTMLElement | null = (el as Element).closest<HTMLElement>(SEL)
  if (!wrap) return null
  let node: HTMLElement = wrap
  // 爬到最外层匹配元素：内部 input 命中的常是 .ant-select-selector / .ant-picker-input 等中间层，
  // 组件根才是可点击、可读回显的正确锚点
  for (;;) {
    const outer: HTMLElement | null = node.parentElement?.closest<HTMLElement>(SEL) ?? null
    if (outer && outer !== node) node = outer
    else break
  }
  const cls = typeof node.className === 'string' ? node.className : ''
  if (!CUSTOM_WRAP_HINT.test(cls)) return null
  if (/cascader/i.test(cls)) return { el: node, kind: 'cascader' }
  if (/picker|date-editor/i.test(cls)) return { el: node, kind: 'date' }
  if (/select/i.test(cls)) return { el: node, kind: 'customselect' }
  return null
}

const FORM_ITEM_HINT = /(^|\s)(form-)?(item|group|field|row)(\s|$)|form-?item|form-?group|form-?field|ant-|el-|arco-/i

/** 分区标题候选排除：侧边导航/步骤条里的分区名（如 Moka 简历页左侧菜单）不是表单分区标题 */
const NAV_CONTAINER = 'nav, aside, [role="menu"], [role="navigation"], [role="tablist"], [class*="sidebar"], [class*="menu"], [class*="step"]'
function inNav(el: Element): boolean {
  return !!el.closest(NAV_CONTAINER)
}

/** 从控件向上找 label 文本：label[for] → closest(label) → 表单容器内的 label/短文本子元素 */
function inferLabel(el: Element): { label: string; near: string[] } {
  const near: string[] = []
  const inputId = (el as HTMLInputElement).id
  if (inputId) {
    const bound = document.querySelector(`label[for="${CSS.escape(inputId)}"]`)
    if (bound) near.push(bound.textContent ?? '')
  }
  const closestLabel = el.closest('label')
  if (closestLabel) near.push(closestLabel.textContent ?? '')

  // 向上最多 4 层找表单行容器，取其中第一个「文本短且不含控件」的子元素。
  // 分区标题（h1-h6/legend/class 含 title|section|header）不算字段 label——
  // 它是分区上下文，混入邻近文本会劫持匹配（"求职意向"是 positions 的别名）。
  const isHeadingLike = (el: Element) =>
    /^H[1-6]$/.test(el.tagName)
    || el.tagName === 'LEGEND'
    || (typeof el.className === 'string' && /title|section|header/i.test(el.className))
  let ancestor: Element | null = el.parentElement
  for (let depth = 0; depth < 6 && ancestor; depth++, ancestor = ancestor.parentElement) {
    const isRow = FORM_ITEM_HINT.test(ancestor.className) || ancestor.classList.contains('form-group')
    for (const child of Array.from(ancestor.children)) {
      if (child.contains(el) || isHeadingLike(child)) continue
      const text = (child.textContent ?? '').trim()
      if (!text || text.length > 30) continue
      // 含控件或按钮/标题的子块是表单行/分区容器（空分区只有标题+添加按钮），不是 label
      if (child.querySelector('input,select,textarea,button,[role=button],h1,h2,h3,h4,h5,h6,legend')) continue
      near.push(text)
      if (isRow) break // 行容器内的第一个文本子元素基本就是 label
    }
    if (isRow && near.length > 0) break
  }

  // 兜底：前一个兄弟短文本
  const prev = el.previousElementSibling
  if (prev && !prev.querySelector('input,select,textarea')) {
    const t = (prev.textContent ?? '').trim()
    if (t && t.length <= 20) near.push(t)
  }

  const aria = el.getAttribute('aria-label') ?? ''
  if (aria) near.push(aria)
  // label 取第一个「含文字/数字」的候选：纯符号（图标🔍、*、：）不算标签
  const label = near.find((t) => /[\w\u4e00-\u9fa5]/.test(t) && !/^\d+$/.test(t.trim())) ?? ''
  return { label: label.trim(), near: near.map((t) => t.trim()).filter(Boolean) }
}

function radioOptions(el: HTMLInputElement): string[] {
  const name = el.name
  const scope = el.closest('form,fieldset,body') ?? document.body
  const group = name
    ? Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`))
    : [el]
  return group.map((r) => {
    const lab = r.closest('label')
    return (lab?.textContent ?? r.parentElement?.textContent ?? r.value).trim()
  }).filter(Boolean)
}

function fieldOf(el: Element, control: ControlKind, sectionKey: SectionKey, sectionHint: string): FieldEl {
  const { label, near } = inferLabel(el)
  const inputEl = el as HTMLInputElement
  const options =
    control === 'select'
      ? Array.from((el as HTMLSelectElement).options).map((o) => o.textContent?.trim() ?? '').filter(Boolean)
      : control === 'radio'
        ? radioOptions(inputEl)
        : control === 'checkbox'
          ? [(el.closest('label')?.textContent ?? el.parentElement?.textContent ?? '').trim()].filter(Boolean)
          : undefined
  const signals: FieldSignals = {
    label,
    labelNear: near.slice(0, 5),
    name: inputEl.name ?? '',
    id: inputEl.id ?? '',
    placeholder: inputEl.placeholder ?? '',
    ariaLabel: el.getAttribute('aria-label') ?? '',
    title: el.getAttribute('title') ?? '',
    sectionText: sectionHint,
    options,
    required: inputEl.required || el.getAttribute('aria-required') === 'true' || /[*＊]/.test(label),
    maxLength: inputEl.maxLength > 0 ? inputEl.maxLength : undefined,
  }
  const sigSource = [label, inputEl.name, inputEl.id, inputEl.placeholder, sectionHint].map(norm).join('|')
  const path = cssPath(el)
  return {
    ref: { cssPath: path, index: 0 },
    control,
    el,
    signals,
    signature: hashSig(sigSource),
  }
}

const ADD_BTN = /^(\+|＋|添加|新增|继续添加|新增一条|添加一条|再添加|增加|add)/i
const NEXT_BTN = /(下一步|下一页|保存并(继续|下一)|继续填写)/i
const SUBMIT_BTN = /(提交|投递|确认提交|立即(申请|投递)|确定提交|递交)/i

function buttonKind(text: string): BtnCandidate['kind'] | null {
  const t = text.trim()
  if (!t || t.length > 16) return null
  if (SUBMIT_BTN.test(t)) return 'submit'
  if (NEXT_BTN.test(t)) return 'next'
  if (ADD_BTN.test(t)) return 'add'
  return null
}

/** 扫描当前 frame（v0：主 frame；北森 iframe 场景 M1 做 frame 聚合） */
export function scanDocument(): FormSnapshot {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  const groups: GroupEl[] = []
  let current: GroupEl = { sectionKey: 'basic', sectionHint: '', kind: 'simple', fields: [], buttons: [] }

  const pushField = (el: Element, overrideKind?: ControlKind) => {
    if (!isVisible(el)) return
    // radio 组只保留组内第一个 input，避免同名组重复计为一个字段
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      const dup = current.fields.find((f) => {
        const prev = f.el as HTMLInputElement
        return prev.type === 'radio' && prev.name !== '' && prev.name === el.name
      })
      if (dup) return
    }
    if (current.fields.some((f) => f.el === el)) return
    const kind = overrideKind ?? controlKindOf(el) ?? 'unknown'
    current.fields.push(fieldOf(el, kind, current.sectionKey, current.sectionHint))
  }

  const seenButtons = new Set<Element>()
  const seenWrappers = new Set<Element>()
  let node = walker.nextNode() as Element | null
  while (node) {
    const el = node
    node = walker.nextNode() as Element | null
    const tag = el.tagName

    // 分区标题：h1-h6 / legend / class 含 title|section 的短文本元素（侧边导航里的不算）
    if (!inNav(el) && (/^H[1-6]$/.test(tag) || tag === 'LEGEND' || (/title|section|header/i.test(el.className) && typeof el.className === 'string'))) {
      const text = (el.textContent ?? '').trim()
      const key = text && text.length <= 30 ? sectionKeyOf(text) : null
      if (key) {
        current = { sectionKey: key, sectionHint: text, kind: REPEAT_SECTIONS.has(key) ? 'repeat' : 'simple', fields: [], buttons: [] }
        groups.push(current)
        continue
      }
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable) {
      if (el instanceof HTMLInputElement && el.type === 'file') {
        // upload 字段：记录但不参与自动填写
        if (isVisible(el)) pushField(el)
        continue
      }
      // 自定义组件：用包装层替代内部 input，控件类型改为组件适配器专用
      const custom = customWrapperFor(el)
      if (custom) {
        if (!seenWrappers.has(custom.el)) {
          seenWrappers.add(custom.el)
          pushField(custom.el, custom.kind)
        }
        continue
      }
      pushField(el)
      continue
    }

    if ((tag === 'BUTTON' || el.getAttribute('role') === 'button' || (tag === 'A' && /btn|button/i.test(el.className))) && !seenButtons.has(el)) {
      const text = (el.textContent ?? el.getAttribute('aria-label') ?? '').trim()
      const kind = buttonKind(text)
      if (kind && isVisible(el)) {
        seenButtons.add(el)
        current.buttons.push({ ref: { cssPath: cssPath(el), index: 0 }, el, text, kind })
      }
    }
  }

  if (groups.length === 0 && (current.fields.length > 0 || current.buttons.length > 0)) groups.push(current)
  // 丢掉重复分组的空壳（同名分区出现多次各自保留，slot 处理时合并视图）
  return {
    url: location.href,
    title: document.title,
    scannedAt: Date.now(),
    framePath: [],
    groups: groups.filter((g) => g.fields.length > 0 || g.buttons.length > 0),
  }
}

/** DOM 变化后按 StableRef 重新定位元素；失败返回 null */
export function resolveRef(ref: { cssPath: string; index: number }): Element | null {
  try {
    const els = document.querySelectorAll(ref.cssPath)
    return els[ref.index] ?? null
  } catch {
    return null
  }
}
