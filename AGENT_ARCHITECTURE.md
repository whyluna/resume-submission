# 通用简历填写混合语义架构

> 版本：v1.0
> 日期：2026-08-22
> 当前状态：本地单元测试与浏览器 E2E 已通过；真实知乎、阿里、中国电信页面待用户只填不保存验收

## 1. 核心决策

本项目不在“规则填入”和“LLM 填入”之间二选一，也不把浏览器直接操作权交给 LLM。

正确分工是：

> 规则负责确定性候选和安全约束，LLM 负责一次性全页面语义复审，本地适配器负责组件操作和权威读回。

| 能力 | 主要负责人 |
|---|---|
| 姓名、手机、学校等标准字段候选 | 规则 |
| 隐私、路径、类型、条目下标和动作安全 | 本地校验器 |
| 长尾字段名、相似字段消歧、合并分区、聚合/派生语义 | LLM |
| 下拉点击、日期拆分、事件触发、重复条目创建 | 本地适配器 |
| 是否真正填写成功 | 本地最终读回 |

LLM 的参与深度体现在“理解所有字段”，不是获得任意 DOM、脚本或坐标操作能力。

## 2. 当前活动链路

```text
结构化 Profile
  +
登录后当前页面 DOM
  ↓
PageModel：分区 / 条目 / 字段 / 控件组 / 禁止动作
  ↓
本地补齐缺少的重复条目，并重新扫描
  ↓
EntryRoute：页面第 N 条 ↔ Profile 具体数组下标
  ↓
规则为每个字段生成 top-N 候选
  ↓
FormPageIR：脱敏组件结构 + 日期槽位 + 下拉交互 + 候选 + facts
  ↓
一次 LLM 请求：全页面语义复审
  ↓
SemanticPlan：fieldId + profilePaths + transform + decision
  ↓
本地再次校验路径 / 条目 / 类型 / 敏感策略 / transform
  ↓
本地适配器批量执行
  ↓
最终重新扫描并读回
  ↓
mapping → written → committed → verified 分层报告
```

活动入口为 `CONTENT_FILL → runSemanticOnce`。旧的多轮 Agent/tool-call 实验模块不在生产入口或 background 消息路由中执行。

## 3. FormPageIR：模型看到什么

模型不接收原始整页 `outerHTML`。Content Script 从当前渲染 DOM 生成白名单、脱敏、可执行约束明确的组件 IR。

每个字段包含：

- 稳定 `fieldId`、分区、页面条目 ID 和下标；
- label、邻近语义、placeholder 和 ARIA；
- `controlKind`、允许的 `transform`；
- 合成的 `componentHtml`，只保留 tag、role、format、interaction 等白名单属性；
- 日期部件的精确槽位，例如 `start-year / start-month / end-year / end-month`；
- 下拉是原生选择，还是必须打开浮层并点击选项；
- `entryRoute.factPrefix`，例如页面项目第 2 条只能引用 `projects[1].*`；
- 规则 top-N 候选、分数和理由；
- 可引用的 Profile facts；受限事实只暴露路径和含义，不暴露真实值。

IR 不包含：

- CSS selector、XPath、坐标；
- 当前输入值、Cookie、Token、URL 查询参数；
- 事件处理器、脚本、任意 data 属性；
- 保存、下一步、提交或删除的执行权限。

## 4. 规则层

规则层不先写页面，也不宣布成功。它只生成候选：

```ts
interface RuleCandidate {
  fieldId: string
  profilePath: string
  score: number
  transform: TransformId
  reason: string
}
```

规则最适合标准字段、明确复合行和类型约束。例如同一“证件号码”行中的选择控件高置信映射 `basic.idType`，文本控件映射 `basic.idNumber`。这个结构约束会进入模型输入和本地校验，防止二者颠倒。

## 5. 单次 LLM 全页面语义复审

配置 API 后，每次填写最多进行一次语义复审请求。模型必须复审所有字段，包括已有高置信规则候选的标准字段，而不是只补规则漏项。

唯一允许的输出是：

```ts
interface SemanticPlanItem {
  fieldId: string
  decision: 'fill' | 'keep-rule' | 'replace-rule' | 'manual' | 'skip'
  profilePaths: string[]
  transform: TransformId
  confidence: number
  reason: string
}
```

模型不能输出 ToolCall、真实值、selector、点击、脚本或 DOM 操作。

模型擅长处理：

- “成长故乡”等长尾叫法；
- “职责”是角色、工作内容还是项目描述；
- 实习/项目合并分区；
- 奖项聚合、摘要和派生是否项；
- 未见过的企业自定义字段。

模型漏项或单项输出不合法时，只对对应字段采用规则候选或 `manual` 安全决策。有效模型决策继续保留，因此不存在“整页 LLM”和“整页规则”二选一。

## 6. 本地语义校验

模型输出在 background 和 content 两侧都不具备直接写权限。进入执行器前至少校验：

- `fieldId` 和 `profilePaths` 必须存在；
- 重复条目的 path 必须属于 `entryRoute.factPrefix`；
- transform 必须属于该组件的 `allowedTransforms`；
- 固定下拉只接受枚举事实；
- 选择控件不得引用身份证号等 restricted 事实；
- 日期组件只能引用日期、日期区间或布尔事实；
- 锁定或非空字段默认 `skip`；
- 复合组件的高置信结构语义不得被颠倒；
- 缺失事实不能由模型生成。

## 7. 重复条目

重复条目在模型请求前由本地逻辑处理：

1. 统计 Profile 中启用的教育、项目、奖项等条目；
2. 只点击被识别为 `add + automatic` 的动作；
3. 每次点击后验证条目数确实增加；
4. 达到目标数后重新扫描；
5. 建立页面条目到 Profile 原始数组下标的显式路由；
6. 禁用条目不会导致后续索引错位；
7. 合并的实习/项目分区按固定顺序建立路由。

删除、保存、下一步和提交动作永不用于自动补条目。

## 8. 日期

Profile 日期原子使用 `YYYY`、`YYYY-MM` 或 `YYYY-MM-DD`，进行中状态独立存储为 `endDateIsNow`。

LLM 只决定语义路径和白名单转换：

- 单日期文本/原生日期：`identity`；
- 单日期拆分年/月/日：`split-date-single`；
- 双输入日期区间：`date-range`；
- 四段或六段日期：`split-date-parts`。

本地执行器依据 IR 的部件角色写入。`2022-09 ~ 2026-06` 不可能被写入四个物理控件；执行器会分别选择 `2022 / 09 / 2026 / 06`，再逐项读回。自定义年月下拉必须打开关联浮层、点击目标选项，并读到已选状态。

## 9. 下拉和搜索组件

下拉成功状态严格定义为：

```text
open linked overlay
→ optionally type query
→ wait options
→ click matching option
→ wait component commit
→ read selected state
```

只在搜索框出现文字不算 `committed`，更不算 `verified`。多个 Portal 同时存在时，优先通过 `aria-controls` 等关联关系找到当前控件的弹层，不能选择页面最后一个任意弹层。

## 10. 执行与最终读回

本地执行器按 SemanticPlan 投影真实 Profile 值并操作组件。执行结束后统一重新发现 PageModel，对初步成功项再次读回。

状态含义：

- `mapped`：语义计划已确定；
- `written`：执行过输入或选择动作；
- `committed`：组件报告已接受状态；
- `verified`：最终重新扫描后的权威状态与期望一致；
- `manual`：缺少事实或控件不安全；
- `failed`：明确写入、提交或读回失败。

只有 `verified` 计入“已填”。

## 11. 诊断与统计

Popup 和页面侧栏必须同时显示：

- 模型请求次数；
- LLM 复审映射数、规则候选映射数、本地安全决策数；
- mapped、written、committed、verified；
- 被拒绝的语义计划数；
- 自动新增条目数；
- 每个待确认/失败字段的 mapping 来源、transform、执行阶段和读回消息；
- 明确的“未保存、未提交”。

这使以下问题能被准确归类：

- 内容进入错误格子：语义映射问题；
- 搜索框有文字但未选中：控件提交问题；
- 日期只写一半：日期投影或部件执行问题；
- 填到错误卡片：PageModel/EntryRoute 问题；
- 报告已填但页面为空：最终读回与统计问题。

## 12. 隐私与安全

- API Key 只存在 background；
- restricted 事实的真实值不进入模型请求；
- 真实值由本地 Profile 在执行阶段解析；
- 原始 HTML、Cookie、Token 和未脱敏快照不发给模型；
- 保存、下一步、声明确认、提交和投递没有自动执行入口；
- 缺失开放题或档案事实保持空白；
- 真实站点测试只填不保存，由用户操作。

## 13. 性能边界

- 每次填写最多 1 次语义复审模型请求；
- 不进行 ReAct 多轮观察/修复；
- 重复条目和组件信息在请求前一次性准备；
- 模型返回完整语义计划后，本地批量执行；
- 请求失败时保留规则候选和本地安全决策；
- 未来可按字段签名缓存语义结果，但每次执行仍必须重新定位和读回。

## 14. 验收边界

当前本地证据：

- 90 个单元测试通过；
- 生产构建通过；
- 完整浏览器 E2E 全部断言通过；
- 单次模型请求、受限身份证本地解析、四段自定义日期、下拉真实选中、重复奖项路由、最终读回和零提交均有测试。

fixture 通过不等于真实站点通过。知乎 Moka、阿里 Kuma 和中国电信 Dayee WT 只有在用户登录后的真实页面完成一次只填不保存验收后，才能从 `fixture-verified` 升级为 `live-verified`。
