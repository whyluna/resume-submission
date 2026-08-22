import type {
  ActionSafety, ControlGroup, ControlGroupKind, ControlPart, ControlPartRole, ElementRefV2,
  AdapterId, PageAction, PageActionKind, PageEntry, PageField, PageModel, PageSection, SemanticSignalsV2,
} from '@/shared/pageModel'
import type { SectionKey } from '@/shared/types'
import { cssPath, hashSig, norm } from '@/shared/util'
import { detectAdapter } from '../adapters/detect'
import { MOKA, mokaAdapter } from '../adapters/moka'
import { dayeeWtAdapter } from '../adapters/dayeeWt'

const CONTROL_SELECTOR = 'input, textarea, select, [contenteditable="true"]'
const NAV_SELECTOR = 'nav, aside, [role="navigation"], [role="menu"], [role="tablist"], [class*="sidebar"], [class*="side-nav"], [class*="step"]'
const SECTION_TITLE_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'legend', '[role="heading"]',
  '[class*="section-title"]', '[class*="sectionTitle"]', '[class*="resume-title"]',
].join(', ')

const REPEAT_SECTIONS = new Set<SectionKey>([
  'educations', 'experiences', 'projects', 'papers', 'competitions', 'awards', 'studentWork',
  'languages', 'itSkills', 'certificates', 'familyMembers',
])

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function isVisible(el: Element): boolean {
  const html = el as HTMLElement
  if (html.hidden) return false
  const rects = el.getClientRects()
  if (rects.length === 0) return false
  const style = getComputedStyle(html)
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.05
}

function makeRef(el: Element): ElementRefV2 {
  const path = cssPath(el)
  const identity = [path, el.tagName, cleanText(el.getAttribute('class')), cleanText(el.getAttribute('role'))].join('|')
  return { cssPath: path, index: 0, framePath: [], signature: hashSig(identity) }
}

function sectionCandidates(title: string): SectionKey[] {
  const text = norm(title)
  if (!text) return []
  if (/实习/.test(text) && /项目/.test(text)) return ['experiences', 'projects']
  if (/实习|工作经历|工作经验/.test(text)) return ['experiences']
  if (/教育|学习经历|学习背景/.test(text)) return ['educations']
  if (/项目/.test(text)) return ['projects']
  if (/专利/.test(text)) return ['papers']
  if (/论文|科研|专业论著|学术/.test(text)) return ['papers']
  if (/竞赛|比赛|大赛/.test(text)) return ['competitions']
  if (/奖励|奖项|获奖|荣誉|奖惩/.test(text)) return ['awards']
  if (/学生工作|校内职务|社会实践|校园活动|校内活动|活动实践/.test(text)) return ['studentWork']
  if (/语言|外语|英语能力/.test(text)) return ['languages']
  if (/计算机技能|IT技能|专业技能|技能特长|技能爱好/.test(text)) return ['itSkills']
  if (/证书/.test(text)) return ['certificates']
  if (/家庭|亲属|社会关系/.test(text)) return ['familyMembers']
  if (/求职意向|应聘信息/.test(text)) return ['intention']
  if (/自我评价|自我描述|个人评价|其他信息/.test(text)) return ['selfEvaluation']
  if (/个人信息|基本信息|基础信息/.test(text)) return ['basic']
  return []
}

function findSectionRoot(titleEl: Element): Element | null {
  let node: Element | null = titleEl
  for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
    if (node.matches(NAV_SELECTOR)) return null
    const looksLikeSection = node.tagName === 'SECTION'
      || (typeof node.className === 'string' && /section|panel|resume-block|resume-part/i.test(node.className))
    if (looksLikeSection && node.querySelector(CONTROL_SELECTOR)) return node
  }
  return null
}

function directTextCandidates(fieldEl: Element): string[] {
  const values: string[] = []
  const add = (text: string | null | undefined) => {
    const value = cleanText(text)
    if (value && value.length <= 60 && /[\w\u4e00-\u9fff]/.test(value)) values.push(value)
  }

  const inputId = (fieldEl as HTMLInputElement).id
  if (inputId) add(fieldEl.ownerDocument.querySelector(`label[for="${CSS.escape(inputId)}"]`)?.textContent)
  add(fieldEl.getAttribute('aria-label'))
  const labelledBy = fieldEl.getAttribute('aria-labelledby')
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) add(fieldEl.ownerDocument.getElementById(id)?.textContent)
  }
  add(fieldEl.closest('label')?.textContent)

  let branch: Element = fieldEl
  let ancestor: Element | null = fieldEl.parentElement
  for (let depth = 0; depth < 12 && ancestor; depth++, ancestor = ancestor.parentElement) {
    if (ancestor.matches(NAV_SELECTOR)) break
    for (const child of Array.from(ancestor.children)) {
      if (child === branch || child.contains(fieldEl)) continue
      if (child.querySelector(CONTROL_SELECTOR)) continue
      const cls = typeof child.className === 'string' ? child.className : ''
      const text = cleanText(child.textContent)
      if (!text || text.length > 60) continue
      if (/label|field-name|field-title|semantic-label|caption/i.test(cls)) values.unshift(text)
      else add(text)
    }
    if (values.length > 0) break
    branch = ancestor
  }
  return Array.from(new Set(values))
}

function signalsFor(el: Element, sectionTitle: string): SemanticSignalsV2 {
  const input = el as HTMLInputElement
  const row = el.closest('.form-item, .semantic-row, [class*="formItem"], [class*="form-item"]')
  const rowLabel = cleanText(row?.querySelector('.form-label, .semantic-label, [class*="formLabel"], [class*="field-label"]')?.textContent)
  const discovered = directTextCandidates(el)
  const near = rowLabel ? [rowLabel, ...discovered.filter((value) => value !== rowLabel)] : discovered
  return {
    label: near[0] ?? '',
    labelNear: near.slice(1, 6),
    placeholder: input.placeholder ?? '',
    name: input.name ?? '',
    id: input.id ?? '',
    ariaLabel: el.getAttribute('aria-label') ?? '',
    title: el.getAttribute('title') ?? '',
    sectionTitle,
  }
}

interface DetectedControl {
  identity: Element
  group: ControlGroup
  signalElement: Element
}

function part(role: ControlPartRole, el: Element): ControlPart {
  return { role, ref: makeRef(el) }
}

function stateOf(controls: Element[]): ControlGroup['currentState'] {
  if (controls.some((el) => (el as HTMLInputElement).disabled)) return 'locked'
  const nonEmpty = controls.some((el) => {
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return el.checked
    if (el instanceof HTMLSelectElement) {
      const selected = cleanText(el.selectedOptions[0]?.textContent || el.value)
      return !!selected && !/^(请选择|请选|选择|select|--+)$/.test(selected.toLowerCase())
    }
    if ((el as HTMLElement).isContentEditable) return !!cleanText(el.textContent)
    const value = (el as HTMLInputElement).value
    return typeof value === 'string' && value.trim() !== ''
  })
  return nonEmpty ? 'non-empty' : 'empty'
}

function optionsOf(el: Element): string[] {
  if (el instanceof HTMLSelectElement) return Array.from(el.options).map((o) => cleanText(o.textContent)).filter(Boolean)
  return []
}

function makeGroup(kind: ControlGroupKind, root: Element, controls: Element[], parts: ControlPart[], strategy: string): ControlGroup {
  const input = controls[0] as HTMLInputElement | undefined
  const required = controls.some((el) => (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true')
  const disabled = controls.some((el) => (el as HTMLInputElement).disabled)
  const readOnly = controls.every((el) => !(el instanceof HTMLInputElement) || el.readOnly)
  let currentState = stateOf(controls)
  if (currentState === 'empty') {
    const selected = root.querySelector('[aria-selected="true"], .ant-select-selection-item, .el-select__selected-item, .selected-label')
    const dataValue = (root as HTMLElement).dataset?.value
    if (cleanText(selected?.textContent) || cleanText(dataValue)) currentState = 'non-empty'
  }
  return {
    id: `control_${makeRef(root).signature}`,
    kind,
    root: makeRef(root),
    parts,
    options: input ? optionsOf(input) : [],
    required,
    disabled,
    readOnly,
    currentState,
    commitStrategy: strategy,
  }
}

function detectControl(el: Element, adapterId: AdapterId): DetectedControl | null {
  const kumaDate = el.closest('.kuma-date-uxform-field-cascade')
  if (kumaDate) {
    const inputs = Array.from(kumaDate.querySelectorAll('input')).filter(isVisible)
    if (inputs.length >= 2) {
      return {
        identity: kumaDate,
        group: makeGroup('date-range', kumaDate, inputs, [part('start', inputs[0]), part('end', inputs[1])], 'kuma-date'),
        signalElement: inputs[0],
      }
    }
  }

  const mokaParts = el.closest('.moka-date-parts')
  if (mokaParts) {
    const inputs = Array.from(mokaParts.querySelectorAll('input')).filter(isVisible)
    if (inputs.length >= 4) {
      const row = mokaParts.parentElement
      const current = row && Array.from(row.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
        .find((checkbox) => /至今|在读|在职|进行中/.test(cleanText(checkbox.closest('label')?.textContent)))
      const controls = current ? [...inputs, current] : inputs
      return {
        identity: mokaParts,
        group: makeGroup('date-range-parts', mokaParts, controls, [
          part('start-year', inputs[0]), part('start-month', inputs[1]),
          part('end-year', inputs[2]), part('end-month', inputs[3]),
          ...(current ? [part('current-toggle', current)] : []),
        ], 'moka-date-parts'),
        signalElement: inputs[0],
      }
    }
  }

  const mokaPicker = adapterId === 'moka' ? el.closest('.ant-picker') : null
  if (mokaPicker) {
    const inputs = Array.from(mokaPicker.querySelectorAll<HTMLInputElement>('input')).filter(isVisible)
    const row = mokaPicker.parentElement
    const current = row && Array.from(row.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .find((checkbox) => /至今|在读|在职|进行中/.test(cleanText(checkbox.closest('label')?.textContent)))
    if (inputs.length >= 2) {
      return {
        identity: mokaPicker,
        group: makeGroup('date-range', mokaPicker, current ? [...inputs, current] : inputs, [
          part('start', inputs[0]), part('end', inputs[1]), ...(current ? [part('current-toggle', current)] : []),
        ], 'moka-ant-picker-range'),
        signalElement: inputs[0],
      }
    }
    if (inputs.length === 1) {
      return {
        identity: mokaPicker,
        group: makeGroup('date-single', mokaPicker, inputs, [part('input', inputs[0])], 'moka-ant-picker-single'),
        signalElement: inputs[0],
      }
    }
  }

  const mokaSearchInput = adapterId === 'moka' && el.matches(MOKA.searchInputSelector)
  if (mokaSearchInput) {
    const root = el.closest(MOKA.searchRootSelector) ?? el.parentElement ?? el
    return {
      identity: root,
      group: makeGroup('combobox', root, [el], [part('root', root), part('trigger', el), part('input', el)], 'moka-remote-search'),
      signalElement: el,
    }
  }

  const kumaSelect = el.closest('.kuma-select2')
  if (kumaSelect) {
    const input = kumaSelect.querySelector('input') ?? el
    return {
      identity: kumaSelect,
      group: makeGroup('combobox', kumaSelect, [input], [part('root', kumaSelect), part('input', input)], 'kuma-select2'),
      signalElement: input,
    }
  }

  const customSelect = el.closest([
    '.ant-select', '.el-select', '.arco-select', '.moka-select', '.select2-container',
    '[class*="select-wrapper"]', '[class*="selectWrapper"]', '[role="combobox"]',
  ].join(','))
  if (customSelect && !(customSelect instanceof HTMLSelectElement)) {
    const input = customSelect.querySelector('input') ?? el
    const searchable = input.getAttribute('aria-autocomplete') === 'list'
      || input.getAttribute('role') === 'combobox'
      || input instanceof HTMLInputElement
    return {
      identity: customSelect,
      group: makeGroup(searchable ? 'combobox' : 'custom-select', customSelect, [input], [
        part('root', customSelect), part('trigger', customSelect), part('input', input),
      ], 'portal-select'),
      signalElement: input,
    }
  }

  if (el instanceof HTMLInputElement && el.classList.contains('dayType')) {
    return {
      identity: el,
      group: makeGroup('date-single', el, [el], [part('input', el)], 'dayee-dayType'),
      signalElement: el,
    }
  }


  if (el instanceof HTMLInputElement && ['date', 'month', 'week', 'datetime-local'].includes(el.type)) {
    return {
      identity: el,
      group: makeGroup('date-single', el, [el], [part('input', el)], 'native-date'),
      signalElement: el,
    }
  }

  if (el instanceof HTMLSelectElement) {
    const strategy = el.classList.contains('selectpicker') ? 'dayee-selectpicker' : 'native-select'
    return {
      identity: el,
      group: makeGroup('native-select', el, [el], [part('option-source', el)], strategy),
      signalElement: el,
    }
  }

  if (el instanceof HTMLInputElement && el.type === 'radio') {
    const scope = el.closest('fieldset, form, section') ?? el.ownerDocument.body
    const radios = el.name
      ? Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]`))
      : [el]
    const root = el.closest('fieldset, [class*="radio"], [class*="field"], [class*="row"]') ?? el.parentElement ?? el
    return {
      identity: radios[0],
      group: makeGroup('radio-group', root, radios, radios.map((radio) => part('input', radio)), 'radio-click'),
      signalElement: el,
    }
  }

  if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    const labelText = cleanText(el.closest('label')?.textContent)
    const owner = el.parentElement?.parentElement
    if (/至今|在读|在职|进行中/.test(labelText) && owner?.querySelector('.moka-date-parts, .ant-picker')) return null
    return {
      identity: el,
      group: makeGroup('checkbox', el, [el], [part('input', el)], 'checkbox-click'),
      signalElement: el,
    }
  }

  if (el instanceof HTMLInputElement && el.type === 'file') {
    return {
      identity: el,
      group: makeGroup('file', el, [el], [part('input', el)], 'manual-file'),
      signalElement: el,
    }
  }

  if (el instanceof HTMLTextAreaElement) {
    return {
      identity: el,
      group: makeGroup('textarea', el, [el], [part('input', el)], 'native-textarea'),
      signalElement: el,
    }
  }

  if ((el as HTMLElement).isContentEditable) {
    return {
      identity: el,
      group: makeGroup('richtext', el, [el], [part('input', el)], 'contenteditable'),
      signalElement: el,
    }
  }

  if (el instanceof HTMLInputElement) {
    return {
      identity: el,
      group: makeGroup('text', el, [el], [part('input', el)], 'native-input'),
      signalElement: el,
    }
  }
  return null
}

function discoverFields(root: Element, sectionTitle: string, adapterId: AdapterId): PageField[] {
  const seen = new Set<Element>()
  const fields: PageField[] = []
  for (const el of Array.from(root.querySelectorAll(CONTROL_SELECTOR))) {
    if (!isVisible(el)) continue
    const detected = detectControl(el, adapterId)
    if (!detected || seen.has(detected.identity)) continue
    seen.add(detected.identity)
    const signals = signalsFor(detected.signalElement, sectionTitle)
    const idSource = [sectionTitle, signals.label, signals.placeholder, detected.group.id].join('|')
    fields.push({ id: `field_${hashSig(idSource)}`, signals, control: detected.group })
  }
  return fields
}

function entryRoots(sectionRoot: Element): Element[] {
  const candidates = Array.from(sectionRoot.querySelectorAll<HTMLElement>('[class*="card"], [class*="entry"], [class*="record"]'))
    .filter((el) => isVisible(el) && !!el.querySelector(CONTROL_SELECTOR))
    .filter((el) => !/form|field|ipt-item|semantic-row|resume-row|uxform/i.test(el.className))
  return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)))
}

function classifyAction(text: string): { kind: PageActionKind; safety: ActionSafety } {
  const value = norm(text)
  if (/添加|新增|增加更多|继续添加/.test(value)) return { kind: 'add', safety: 'automatic' }
  if (/删除|移除/.test(value)) return { kind: 'delete', safety: 'manual' }
  if (/提交|投递|确认提交|选择职位/.test(value)) return { kind: 'submit', safety: 'forbidden' }
  if (/下一步|下一页|继续填写/.test(value)) return { kind: 'next', safety: 'forbidden' }
  if (/保存|暂存|完成/.test(value)) return { kind: 'save', safety: 'forbidden' }
  if (/同意|声明|承诺/.test(value)) return { kind: 'consent', safety: 'forbidden' }
  return { kind: 'other', safety: 'manual' }
}

function actionCandidates(root: Element): PageAction[] {
  const selector = 'button, a, [role="button"], [class*="add"], [class*="save"], [class*="submit"]'
  const seen = new Set<Element>()
  const actions: PageAction[] = []
  for (const el of Array.from(root.querySelectorAll(selector))) {
    if (seen.has(el) || !isVisible(el)) continue
    const text = cleanText(el.textContent || el.getAttribute('aria-label'))
    if (!text || text.length > 40) continue
    const classified = classifyAction(text)
    if (classified.kind === 'other' && !/add|save|submit|button|btn/i.test(String((el as HTMLElement).className))) continue
    seen.add(el)
    const ref = makeRef(el)
    actions.push({ id: `action_${ref.signature}`, text, ref, ...classified })
  }
  return actions
}

function discoverSections(doc: Document): Array<{ title: string; root: Element; semanticCandidates: SectionKey[] }> {
  const found: Array<{ title: string; root: Element; semanticCandidates: SectionKey[] }> = []
  const seen = new Set<Element>()
  for (const titleEl of Array.from(doc.querySelectorAll(SECTION_TITLE_SELECTOR))) {
    if (!isVisible(titleEl) || titleEl.closest(NAV_SELECTOR)) continue
    const title = cleanText(titleEl.textContent)
    if (!title || title.length > 60) continue
    const candidates = sectionCandidates(title)
    if (candidates.length === 0) continue
    const root = findSectionRoot(titleEl)
    if (!root || seen.has(root)) continue
    seen.add(root)
    found.push({ title, root, semanticCandidates: candidates })
  }
  return found
}

export function discoverPageModel(doc: Document = document, url: string = location.href): PageModel {
  const adapter = detectAdapter({ document: doc, url })
  const discovered = discoverSections(doc)
  const sectionRoots = new Set(discovered.map((section) => section.root))
  const sections: PageSection[] = discovered.map((section) => {
    const repeat = section.semanticCandidates.some((candidate) => REPEAT_SECTIONS.has(candidate))
    const explicitRoots = entryRoots(section.root)
    const roots = repeat && explicitRoots.length === 0 && section.root.querySelector(CONTROL_SELECTOR)
      ? [section.root]
      : explicitRoots
    const entries: PageEntry[] = roots.map((root, index) => {
      const ref = makeRef(root)
      return {
        id: `entry_${ref.signature}`,
        index,
        root: ref,
        kindCandidates: section.semanticCandidates,
        fields: discoverFields(root, section.title, adapter.id),
      }
    })
    const sectionRef = makeRef(section.root)
    return {
      id: `section_${sectionRef.signature}`,
      title: section.title,
      root: sectionRef,
      semanticCandidates: section.semanticCandidates,
      entries,
      fields: roots.length > 0 || repeat ? [] : discoverFields(section.root, section.title, adapter.id),
      actions: actionCandidates(section.root),
    }
  })

  const globalActions = actionCandidates(doc.body).filter((action) => {
    let element: Element | null = null
    try { element = doc.querySelector(action.ref.cssPath) } catch { /* invalid ref stays global */ }
    return !element || !Array.from(sectionRoots).some((root) => root.contains(element))
  })

  return {
    version: 2,
    url,
    title: doc.title,
    capturedAt: Date.now(),
    adapterId: adapter.id,
    adapterMaturity: adapter.id === 'moka' ? mokaAdapter.maturity
      : adapter.id === 'dayee-wt' ? dayeeWtAdapter.maturity
        : 'research',
    sections,
    globalActions,
  }
}
