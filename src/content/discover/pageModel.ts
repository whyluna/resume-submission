import type {
  ActionSafety, ControlGroup, ControlGroupKind, ControlPart, ControlPartRole, ElementRefV2,
  AdapterId, PageAction, PageActionKind, PageEntry, PageField, PageModel, PageSection, SemanticSignalsV2,
} from '@/shared/pageModel'
import type { SectionKey } from '@/shared/types'
import { cssPath, hashSig, norm } from '@/shared/util'
import { detectAdapter } from '../adapters/detect'
import { MOKA, mokaAdapter } from '../adapters/moka'
import { dayeeWtAdapter } from '../adapters/dayeeWt'
import { kumaAdapter } from '../adapters/kuma'

const CONTROL_SELECTOR = 'input, textarea, select, [contenteditable="true"]'
const FORM_ROW_SELECTOR = '.form-item, .semantic-row, [class*="formItem"], [class*="form-item"], [class*="field-row"], [class*="form-row"], [role="group"]'
const NAV_SELECTOR = 'nav, aside, [role="navigation"], [role="menu"], [role="tablist"], [class*="sidebar"], [class*="side-nav"], [class*="step"]'
const SECTION_TITLE_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'legend', '[role="heading"]',
  '[class*="section-title"]', '[class*="sectionTitle"]', '[class*="resume-title"]',
  '[class*="module-title"]', '[class*="moduleTitle"]', '[class*="block-title"]',
  '[class*="blockTitle"]', '[class*="form-title"]', '[class*="formTitle"]',
  '[class*="header"]', '[class*="Header"]', '[class*="title"]', '[class*="Title"]',
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
  const identity = [path, el.tagName, cleanText(el.getAttribute('role'))].join('|')
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
  let nearestWithControls: Element | null = null
  for (let depth = 0; depth < 12 && node; depth++, node = node.parentElement) {
    if (node.matches(NAV_SELECTOR)) return null
    if (!nearestWithControls && node.querySelector(CONTROL_SELECTOR)) nearestWithControls = node
    const looksLikeSection = node.tagName === 'SECTION'
      || (typeof node.className === 'string' && /section|panel|resume-block|resume-part/i.test(node.className))
    if (looksLikeSection && node.querySelector(CONTROL_SELECTOR)) return node
  }
  return nearestWithControls
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

function part(role: ControlPartRole, el: Element, controlKind?: ControlGroupKind): ControlPart {
  return { role, ref: makeRef(el), ...(controlKind ? { controlKind } : {}) }
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

interface FieldRecord {
  field: PageField
  row: Element | null
  identity: Element
  signalElement: Element
}

function datePartToken(record: FieldRecord): string {
  const input = record.signalElement as HTMLInputElement
  return norm([
    input.placeholder,
    input.getAttribute('aria-label'),
    input.getAttribute('title'),
    record.field.signals.label,
    ...record.field.control.options.slice(0, 8),
  ].filter(Boolean).join(' '))
}

function commonRecordAncestor(records: FieldRecord[]): Element | null {
  if (records.length === 0) return null
  for (let node: Element | null = records[0].identity; node; node = node.parentElement) {
    if (records.every((record) => node?.contains(record.identity))) return node
  }
  return null
}

function leafSemanticTexts(root: Element): string[] {
  const direct = Array.from(root.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => cleanText(node.textContent))
  const leaves = Array.from(root.querySelectorAll('*'))
    .filter((element) => !element.matches(CONTROL_SELECTOR) && !element.querySelector(CONTROL_SELECTOR))
    .map((element) => cleanText(element.textContent))
  return Array.from(new Set([...direct, ...leaves].filter((text) => text && text.length <= 60)))
}

function dateScopeLabel(root: Element | null): string {
  if (!root) return ''
  return leafSemanticTexts(root).find((text) => /日期|时间|年月|出生|入学|毕业|起止|获奖|任职/.test(norm(text))) ?? ''
}

function semanticDateAncestorGroups(records: FieldRecord[]): FieldRecord[][] {
  const groups: FieldRecord[][] = []
  const roots = new Set<Element>()
  const currentToggle = (record: FieldRecord) => record.field.control.kind === 'checkbox'
    && /至今|在读|在职|进行中/.test(datePartToken(record))
  const datePartLike = (record: FieldRecord) => ['native-select', 'custom-select', 'combobox', 'text'].includes(record.field.control.kind)
    && /年|月|日|yyyy|mm|dd|year|month|day|start|end|开始|结束|日期|时间/.test(datePartToken(record))
  const supported = (record: FieldRecord) => datePartLike(record) || currentToggle(record)
  for (const record of records.filter((candidate) => datePartLike(candidate))) {
    let node = record.identity.parentElement
    for (let depth = 0; node && depth < 9; depth++) {
      if (node.matches(NAV_SELECTOR)) break
      const current = node
      const inside = records.filter((candidate) => supported(candidate) && current.contains(candidate.identity))
      const toggles = inside.filter(currentToggle)
      const dateControls = inside.filter((candidate) => !toggles.includes(candidate))
      node = current.parentElement
      if (![4, 6].includes(dateControls.length) || !dateScopeLabel(current)) continue
      if (!roots.has(current)) { roots.add(current); groups.push(inside) }
      break
    }
  }
  return groups
}

function combineGenericDateRows(records: FieldRecord[], sectionTitle: string): FieldRecord[] {
  const byRow = new Map<Element, FieldRecord[]>()
  for (const record of records) {
    if (!record.row) continue
    const list = byRow.get(record.row) ?? []
    list.push(record)
    byRow.set(record.row, list)
  }
  const byLabel = new Map<string, FieldRecord[]>()
  for (const record of records) {
    const label = norm(record.field.signals.label)
    if (!label || !/日期|时间|年月|出生|入学|毕业|起止|获奖|任职/.test(label)) continue
    const list = byLabel.get(label) ?? []
    list.push(record)
    byLabel.set(label, list)
  }
  const groupKey = (group: FieldRecord[]) => group.map((record) => record.field.id).sort().join('|')
  const candidateGroups = [...byRow.values(), ...byLabel.values(), ...semanticDateAncestorGroups(records)]
    .filter((group) => group.length >= 2)
    .filter((group, index, groups) => groups.findIndex((candidate) => groupKey(candidate) === groupKey(group)) === index)
  const consumed = new Set<FieldRecord>()
  const combined: FieldRecord[] = []
  for (const rowRecords of candidateGroups) {
    if (rowRecords.some((record) => consumed.has(record))) continue
    const common = commonRecordAncestor(rowRecords)
    const scopeLabel = dateScopeLabel(common)
    const signal = norm([...rowRecords.flatMap((record) => [record.field.signals.label, ...record.field.signals.labelNear]), scopeLabel].join(' '))
    if (!/日期|时间|年月|出生|入学|毕业|起止|获奖|任职/.test(signal)) continue
    const toggle = rowRecords.find((record) => record.field.control.kind === 'checkbox'
      && /至今|在读|在职|进行中/.test(datePartToken(record)))
    const dateRecords = rowRecords.filter((record) => record !== toggle)
    if (![2, 4, 6].includes(dateRecords.length)) continue
    const supported = dateRecords.every((record) => ['native-select', 'custom-select', 'combobox', 'date-single', 'text'].includes(record.field.control.kind))
    if (!supported) continue
    const tokens = dateRecords.map(datePartToken)
    const twoPartSingle = dateRecords.length === 2
      && (/年|yyyy/.test(tokens[0]) || /月|mm/.test(tokens[1]))
      && /月|mm/.test(tokens[1])
    const twoPartRange = dateRecords.length === 2 && !twoPartSingle
      && (/起止|就读|工作|实习|项目|任职|教育/.test(signal)
        || dateRecords.every((record) => record.field.control.kind === 'date-single'))
    const kind: ControlGroupKind = dateRecords.length >= 4 ? 'date-range-parts' : twoPartRange ? 'date-range' : 'date-parts'
    const roles: ControlPartRole[] = dateRecords.length === 6
      ? ['start-year', 'start-month', 'start-day', 'end-year', 'end-month', 'end-day']
      : dateRecords.length === 4
        ? ['start-year', 'start-month', 'end-year', 'end-month']
        : twoPartRange ? ['start', 'end'] : ['year', 'month']
    const controls = [...dateRecords.map((record) => record.signalElement), ...(toggle ? [toggle.signalElement] : [])]
    const row = commonRecordAncestor(dateRecords) ?? dateRecords[0].row ?? dateRecords[0].identity
    const parts = dateRecords.map((record, index) => part(roles[index], record.identity, record.field.control.kind))
    if (toggle) parts.push(part('current-toggle', toggle.identity, toggle.field.control.kind))
    const first = dateRecords[0]
    const control = makeGroup(kind, row, controls, parts, 'generic-semantic-date-group')
    const idSource = [sectionTitle, kind, control.id].join('|')
    const signals = scopeLabel ? {
      ...first.field.signals,
      label: scopeLabel,
      labelNear: Array.from(new Set([first.field.signals.label, ...first.field.signals.labelNear].filter((value) => value && value !== scopeLabel))),
    } : first.field.signals
    combined.push({
      field: { id: `field_${hashSig(idSource)}`, signals, control },
      row,
      identity: row,
      signalElement: first.signalElement,
    })
    dateRecords.forEach((record) => consumed.add(record))
    if (toggle) consumed.add(toggle)
  }
  return [...records.filter((record) => !consumed.has(record)), ...combined]
}

function assignCompoundGroups(records: FieldRecord[]): void {
  const byRow = new Map<Element, FieldRecord[]>()
  const byLabel = new Map<string, FieldRecord[]>()
  for (const record of records) {
    if (record.row) {
      const list = byRow.get(record.row) ?? []
      list.push(record)
      byRow.set(record.row, list)
    }
    const label = norm(record.field.signals.label)
    if (label && /证件|电话|手机|区号|薪资|工资|成绩|分数|排名/.test(label)) {
      const list = byLabel.get(label) ?? []
      list.push(record)
      byLabel.set(label, list)
    }
  }
  const assigned = new Set<FieldRecord>()
  const groups = [...byRow.values(), ...byLabel.values()]
  for (const group of groups) {
    if (group.length < 2 || group.length > 4 || group.some((record) => assigned.has(record))) continue
    const root = commonRecordAncestor(group) ?? group[0].row ?? group[0].identity
    const groupId = `compound_${makeRef(root).signature}`
    group.forEach((record, index) => {
      record.field.compoundGroupId = groupId
      record.field.compoundIndex = index
      record.field.compoundSize = group.length
      assigned.add(record)
    })
  }
}

function discoverFields(root: Element, sectionTitle: string, adapterId: AdapterId): PageField[] {
  const seen = new Set<Element>()
  const records: FieldRecord[] = []
  for (const el of Array.from(root.querySelectorAll(CONTROL_SELECTOR))) {
    if (!isVisible(el)) continue
    const detected = detectControl(el, adapterId)
    if (!detected || seen.has(detected.identity)) continue
    seen.add(detected.identity)
    const signals = signalsFor(detected.signalElement, sectionTitle)
    const idSource = [sectionTitle, detected.group.id].join('|')
    records.push({
      field: { id: `field_${hashSig(idSource)}`, signals, control: detected.group },
      row: detected.signalElement.closest(FORM_ROW_SELECTOR),
      identity: detected.identity,
      signalElement: detected.signalElement,
    })
  }
  const grouped = combineGenericDateRows(records, sectionTitle)
  assignCompoundGroups(grouped)
  return grouped.map((record) => record.field)
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

const CANONICAL_SECTION_TITLE_RE = /^(?:个人信息|基本信息|基础信息|求职意向|应聘信息|教育背景|教育经历|学习经历|学习背景|工作经历|工作经验|实习经历|实习经验|项目经验|项目经历|语言能力|外语能力|自我描述|自我评价|个人评价|获奖经历|奖励与荣誉|奖惩情况|学生工作|校园活动|社会实践|科研成果|论文|证书|家庭成员(?:及社会关系)?|家庭及社会关系)$/
const FIELD_LIKE_TITLE_RE = /(?:名称|时间|日期|年月|类型|号码|描述|职责|内容|城市|薪资|程度|分数|成绩|学校|专业|学历|学位|公司|职位)$/

function canonicalSectionTitle(raw: string): string {
  return cleanText(raw).replace(/[\uE000-\uF8FF]/g, '').replace(/(?:添加|新增|增加更多)$/g, '').trim()
}

function discoverSections(doc: Document): Array<{ title: string; root: Element; semanticCandidates: SectionKey[] }> {
  const found: Array<{ title: string; root: Element; titleEl: Element; semanticCandidates: SectionKey[] }> = []
  const seen = new Set<Element>()
  for (const titleEl of Array.from(doc.querySelectorAll(SECTION_TITLE_SELECTOR))) {
    if (!isVisible(titleEl) || titleEl.closest(NAV_SELECTOR)) continue
    const title = canonicalSectionTitle(titleEl.textContent ?? '')
    if (!title || title.length > 60) continue
    if (/^(.{2,12})\1$/.test(title)) continue
    const candidates = sectionCandidates(title)
    if (candidates.length === 0) continue
    if (FIELD_LIKE_TITLE_RE.test(title) && !CANONICAL_SECTION_TITLE_RE.test(title)) continue
    const root = findSectionRoot(titleEl)
    if (!root || seen.has(root)) continue
    seen.add(root)
    found.push({ title, root, titleEl, semanticCandidates: candidates })
  }
  return found.filter((candidate) => {
    if (found.some((other) => other !== candidate && other.title === candidate.title
      && other.root !== candidate.root && other.root.contains(candidate.root))) return false
    const parent = found.find((other) => other !== candidate && other.root !== candidate.root
      && other.root.contains(candidate.root) && other.semanticCandidates.some((value) => value === 'basic' || value === 'intention'))
    const controls = candidate.root.querySelectorAll(CONTROL_SELECTOR).length
    if (parent && controls <= 1 && candidate.semanticCandidates.some((value) => value === 'experiences')) return false
    return true
  }).map(({ title, root, semanticCandidates }) => ({ title, root, semanticCandidates }))
}

export function discoverPageModel(doc: Document = document, url: string = location.href): PageModel {
  const adapter = detectAdapter({ document: doc, url })
  const discovered = discoverSections(doc)
  const sectionRoots = new Set(discovered.map((section) => section.root))
  const sections: PageSection[] = discovered.map((section) => {
    const repeat = section.semanticCandidates.some((candidate) => REPEAT_SECTIONS.has(candidate))
    const explicitRoots = repeat ? entryRoots(section.root) : []
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
        : adapter.id === 'kuma' ? kumaAdapter.maturity
        : 'research',
    sections,
    globalActions,
  }
}
