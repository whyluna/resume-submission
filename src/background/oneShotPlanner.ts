import type { AgentFactRef, AgentToolCall } from '@/shared/agent'
import { ACTION_AGENT_TOOLS, type FormFieldIR, type FormPageIR } from '@/shared/formIr'
import { validateOneShotPlan } from '@/shared/oneShotValidation'
import type { OneShotPlannerResponse, Settings } from '@/shared/types'
import { chat, parseJsonLoose } from './llm'

const ONE_SHOT_SYSTEM = `你是通用招聘表单的语义规划器。页面组件已经被本地程序解析为脱敏 FormPageIR。你只负责决定每个页面字段应引用哪个简历 fact，并选择一个白名单动作工具；本地程序负责真正点击、输入、提交控件值并回读验证。

硬性要求：
1. 对 fields 中每个 fieldId 必须且只能返回一个动作；不能漏项、重复或只返回有把握的少数字段。没有事实用 mark_manual，已有值或不应填写用 mark_skip。
2. 只能使用 availableTools。禁止 inspect、ensure_entries、verify、任意点击/脚本，以及保存、下一步、提交、删除。
3. 重复分区必须遵守 entryRoute.factPrefix，不能把第 1 个项目或奖项重复写到后续条目。
4. 日期依据 constraints.dateShape 和 parts 的 role/format 判断 single/range；只引用独立日期 factId，不能把完整日期区间塞进年/月槽位。
5. 下拉必须用 select_option_from_fact；输入搜索文字不代表选中。固定下拉只用 enum fact，combobox/cascader 可引用对应文本或列表 fact。
6. 只引用提供的 factId，不输出真实值。敏感事实仍可供本地文本填写，但禁止用于选择控件。
7. ruleHints 只是候选；componentHtml、parts、entryRoute 和字段语义共同决定最终映射。高置信复合控件提示不得随意颠倒（例如证件类型与证件号码）。

只输出严格 JSON 对象 {"calls":[...]}，不要 markdown、解释、注释或省略号。`

function parseCalls(raw: string): unknown[] {
  const parsed = parseJsonLoose<unknown>(raw)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as { calls?: unknown }).calls)) {
    return (parsed as { calls: unknown[] }).calls
  }
  return []
}

function generated(field: FormFieldIR, index: number, tool: AgentToolCall['tool'], args: AgentToolCall['args'], reason: string): AgentToolCall {
  return { callId: `fallback_${index}`, tool, reason, args } as AgentToolCall
}

function factByPath(ir: FormPageIR): Map<string, AgentFactRef> {
  return new Map(ir.facts.map((fact) => [fact.path, fact]))
}

function dateFallback(field: FormFieldIR, facts: Map<string, AgentFactRef>, index: number): AgentToolCall | undefined {
  const range = field.constraints.dateShape === 'range' || field.constraints.dateShape === 'range-parts'
  if (range) {
    const prefix = field.entryRoute?.factPrefix
    const start = prefix ? facts.get(`${prefix}.startDate`) : undefined
    const end = prefix ? facts.get(`${prefix}.endDate`) : undefined
    const current = prefix ? facts.get(`${prefix}.endDateIsNow`) : undefined
    if (!start || (!end && !current)) return undefined
    return generated(field, index, 'fill_date_from_facts', {
      fieldId: field.fieldId,
      startFactId: start.factId,
      ...(end ? { endFactId: end.factId } : {}),
      ...(current ? { currentFactId: current.factId } : {}),
      requestedShape: 'range',
    }, '本地规则回退：重复条目日期区间')
  }
  const hinted = field.ruleHints.map((hint) => facts.get(hint.path))
    .find((fact) => fact && (fact.valueType === 'date' || fact.valueType === 'date-range'))
  if (!hinted || hinted.valueType === 'date-range') return undefined
  return generated(field, index, 'fill_date_from_facts', {
    fieldId: field.fieldId, startFactId: hinted.factId, requestedShape: 'single',
  }, '本地规则回退：单日期')
}

/** Complete deterministic fallback. It never mixes a partial model plan with local rules. */
export function buildRuleFallbackPlan(ir: FormPageIR): AgentToolCall[] {
  const facts = factByPath(ir)
  return ir.fields.map((field, index) => {
    if (field.existingState === 'locked') {
      return generated(field, index, 'mark_skip', { fieldId: field.fieldId, reason: '字段已锁定' }, '本地安全回退')
    }
    if (field.existingState === 'non-empty') {
      return generated(field, index, 'mark_skip', { fieldId: field.fieldId, reason: '字段已有值，不覆盖' }, '本地安全回退')
    }
    if (!field.entryRoute && field.entryId) {
      return generated(field, index, 'mark_manual', { fieldId: field.fieldId, reason: '页面条目没有对应档案条目' }, '本地安全回退')
    }
    if (field.capabilities.includes('fill-date')) {
      return dateFallback(field, facts, index)
        ?? generated(field, index, 'mark_manual', { fieldId: field.fieldId, reason: '没有完整且类型正确的日期事实' }, '本地安全回退')
    }
    const hinted = field.ruleHints.map((hint) => facts.get(hint.path)).find((fact) => fact?.hasValue)
    if (!hinted) return generated(field, index, 'mark_manual', { fieldId: field.fieldId, reason: '规则没有可靠事实候选' }, '本地安全回退')
    if (field.capabilities.includes('select-option')) {
      const fixed = ['native-select', 'custom-select', 'radio-group'].includes(field.controlKind)
      if (hinted.sensitivity === 'restricted' || (fixed && hinted.valueType !== 'enum')) {
        return generated(field, index, 'mark_manual', { fieldId: field.fieldId, reason: '下拉事实类型不安全或不兼容' }, '本地安全回退')
      }
      return generated(field, index, 'select_option_from_fact', {
        fieldId: field.fieldId, factId: hinted.factId, match: 'synonym',
      }, '本地规则回退：选项语义')
    }
    if (field.capabilities.includes('toggle')) {
      if (hinted.valueType !== 'boolean') return generated(field, index, 'mark_manual', { fieldId: field.fieldId, reason: '开关缺少布尔事实' }, '本地安全回退')
      return generated(field, index, 'set_boolean_from_fact', { fieldId: field.fieldId, factId: hinted.factId }, '本地规则回退：布尔语义')
    }
    if (field.capabilities.includes('write-text')) {
      return generated(field, index, 'fill_text_from_fact', {
        fieldId: field.fieldId, factIds: [hinted.factId], transform: hinted.valueType === 'list' ? 'join-list' : 'identity',
      }, '本地规则回退：文本语义')
    }
    return generated(field, index, 'mark_manual', { fieldId: field.fieldId, reason: '控件没有可自动执行能力' }, '本地安全回退')
  })
}

export async function planOneShot(ir: FormPageIR, settings: Settings): Promise<OneShotPlannerResponse> {
  const started = Date.now()
  const fallback = (reason: string, rejected: string[] = []): OneShotPlannerResponse => ({
    ok: true,
    mode: 'rule-fallback',
    calls: buildRuleFallbackPlan(ir),
    modelRequestCount: 0,
    complete: true,
    rejected,
    messages: [reason, '模型计划未与规则计划混用'],
    latencyMs: Date.now() - started,
  })
  if (settings.privacyMode === 'off' || !settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    return fallback('模型未配置或隐私模式关闭，使用完整本地规则计划')
  }

  try {
    const output = await chat(settings, [
      { role: 'system', content: ONE_SHOT_SYSTEM },
      { role: 'user', content: JSON.stringify({
        mode: 'one-shot-complete-plan',
        availableTools: ACTION_AGENT_TOOLS,
        form: ir,
        outputSchema: {
          calls: [{
            callId: 'unique id', tool: 'one available tool', reason: 'short reason',
            args: { fieldId: 'exact fieldId', factId: 'exact factId when required' },
          }],
        },
      }) },
    ], { maxTokens: 16_000, temperature: 0, timeoutMs: 75_000, jsonMode: true })
    const validated = validateOneShotPlan(parseCalls(output), ir)
    if (!validated.complete) {
      return {
        ...fallback(`模型完整计划校验失败：漏项 ${validated.missingFieldIds.length}，拒绝 ${validated.rejected.length}`, validated.rejected),
        modelRequestCount: 1,
      }
    }
    return {
      ok: true,
      mode: 'llm',
      calls: validated.calls,
      modelRequestCount: 1,
      complete: true,
      rejected: [],
      messages: [`单次模型计划完整覆盖 ${validated.calls.length} 个字段`],
      latencyMs: Date.now() - started,
    }
  } catch (error) {
    return { ...fallback(`单次模型请求失败，使用完整本地规则计划：${(error as Error).message}`), modelRequestCount: 1 }
  }
}
