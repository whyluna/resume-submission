# 通用校招简历自动填写开发计划

> 版本：v0.3
> 日期：2026-08-22
> 对应需求：`REQUIREMENTS.md`
> 实施原则：先建立正确结构与可观测性，再扩展平台；每个平台必须经过真实页面只填不保存验收

## 1. 开发目标

将当前“扁平扫描 + 规则直接写入 + LLM 兜底”迁移为：

```text
页面采集
  → PageModel（分区/条目/语义字段/控件组/动作）
  → Profile Fact Catalog + 规则提示
  → LLM Agent 选择白名单语义工具
  → 本地 Tool Gateway 校验与执行
  → 页面 authoritative readback
  → 失败/歧义结果返回 LLM 有界修复
  → 终态诊断报告
```

开发不以“增加更多别名”作为主要完成标准。别名只服务于候选生成，真实页面结构识别和组件
提交状态才是验收依据。

## 2. 已锁定决策

1. 产品仍然只填不提交。
2. LLM 在启用 API 时默认参与所有分区的语义复审，不只是未匹配兜底。
3. LLM 只生成语义计划和转换选择，不直接生成选择器或执行 DOM 操作。
4. 规则层保留，承担确定性候选、安全限制、类型约束和离线模式。
5. 置信度统一为 0~1。
6. 填写成功必须经过 authoritative readback。
7. 站点支持状态分为 research / fixture-verified / live-verified。
8. 第一批平台顺序：核心引擎 → Moka → DayeeWT → Kuma → Beisen。
9. 北森在获得登录后真实脱敏结构前不进入“已支持”列表。
10. 真实简历和未脱敏 DOM 快照不得进入仓库。

## 3. 迁移策略

### 3.1 双路径过渡

新增 `plannerV2` 功能开关：

- 旧路径在迁移期间保持可运行，作为回归基线；
- 新路径独立生成 PageModel、SemanticPlan 和 ExecutionReport；
- Moka 真实验收通过后，默认切换到 V2；
- DayeeWT 和 Kuma 完成后删除旧的扁平规划路径；
- 不在一次提交中同时重写扫描、LLM、执行器和 UI。

### 3.2 目录规划

```text
src/
├── shared/
│   ├── pageModel.ts          # Page/Section/Entry/Field/ControlGroup/Action
│   ├── semanticPlan.ts       # 规则候选、LLM 计划、转换和状态
│   ├── profileFacts.ts       # 强类型档案 + 可扩展事实库
│   └── privacy.ts            # 敏感路径、脱敏和请求审计
├── content/
│   ├── discover/
│   │   ├── sections.ts
│   │   ├── entries.ts
│   │   ├── labels.ts
│   │   ├── controls.ts
│   │   └── actions.ts
│   ├── adapters/
│   │   ├── generic.ts
│   │   ├── moka.ts
│   │   ├── dayeeWt.ts
│   │   ├── kuma.ts
│   │   └── beisen.ts
│   ├── planner/
│   │   ├── ruleCandidates.ts
│   │   ├── projection.ts
│   │   └── validatePlan.ts
│   ├── controls/
│   │   ├── text.ts
│   │   ├── select.ts
│   │   ├── combobox.ts
│   │   ├── date.ts
│   │   ├── cascader.ts
│   │   ├── richtext.ts
│   │   └── repeat.ts
│   ├── capture/
│   │   ├── sanitize.ts
│   │   └── export.ts
│   └── report/
│       ├── executionReport.ts
│       └── panel.ts
├── background/
│   ├── llmPlanner.ts
│   └── llmSchema.ts
└── options/
    └── DiagnosticsTab.tsx
```

迁移中可复用现有文件，但最终职责必须按上述边界拆开。

## 4. 里程碑总览

| 里程碑 | 目标 | 真实验收门槛 |
|---|---|---|
| M0 | 基线、红测与脱敏样本 | 当前行为可复现，安全不变量有测试 |
| M1 | PageModel 与采集器 | 能正确描述知乎/阿里/中国电信结构，不写值 |
| M2 | 规则候选 + LLM 全分区规划 | 超过100字段不截断，计划可验证可回退 |
| M3 | 可验证控件执行器 | 下拉、日期、重复条目均以读回判定成功 |
| M4 | MokaAdapter | 知乎真实页只填不保存通过 |
| M5 | DayeeWTAdapter | 中国电信 + 银行/央企公开表单通过 |
| M6 | KumaAdapter | 阿里真实页只填不保存通过 |
| M7 | Beisen 与通用长尾 | 北森真实样本通过，Generic 能安全降级 |
| M8 | 产品化与发布 | 隐私审计、性能、文档和回归矩阵完成 |

### 4.1 LLM Agent 迁移进度

| Agent 阶段 | 当前状态 | 已有证据 |
|---|---|---|
| A1 合同 | 已完成 | 事实引用、工具调用、结果、trace、严格运行时白名单 |
| A2 通用能力 | 进行中 | 日期原子/区间/年月日部件；复杂复合行和更多动态组件待扩展 |
| A3 工具网关 | 已完成 | 文本、枚举、日期、布尔、条目、检查、复验；无保存/提交工具 |
| A4 Agent 循环 | 已完成 beta | 最多 3 轮 plan/act/readback/repair，漏项最终转人工 |
| A5 影子与 E2E | 已完成最小闭环 | 真实扩展消息链 4 工具验证，提交按钮零点击 |
| A6 实页灰度 | 待验收 | 知乎、阿里、中国电信需重新加载扩展后逐站只填不保存验收 |
| A7 移除静态默认 | 未开始 | 仅在 A6 通过后执行 |

## 5. M0：冻结基线并建立红测

### 5.1 任务

- [ ] 保存当前 `npm run e2e` 结果作为旧路径基线；
- [ ] 为以下已知故障添加失败测试：
  - [ ] label 不在 `label` 元素中；
  - [ ] placeholder 仅包含别名但在加分前被阈值丢弃；
  - [ ] 空 label 导致错误的条目下标；
  - [ ] 工作与实习同为 `experiences` 时串区；
  - [ ] 搜索下拉只输入未选中；
  - [ ] 年/月四控件日期；
  - [ ] 页面已有卡片但规则未匹配时被误判为零槽位；
  - [ ] LLM 0.9 与规则 95 的置信度单位冲突；
  - [ ] 61~150 号字段未进入 LLM；
  - [ ] disabled 字段被尝试写入；
- [ ] 为保存、暂存、下一步、提交、声明按钮建立零点击安全测试；
- [ ] 整理知乎、阿里、中国电信结构的脱敏 fixture；
- [ ] 在 fixture 中使用完全虚构值。

### 5.2 交付物

- `e2e/fixtures/moka-real-structure.html`
- `e2e/fixtures/kuma-real-structure.html`
- `e2e/fixtures/dayee-wt-real-structure.html`
- PageModel 单元测试输入样本
- 当前问题清单及对应测试编号

### 5.3 完成门槛

- 新测试能稳定复现真实页面问题；
- 旧测试仍通过；
- fixture 和日志中无真实个人信息。

## 6. M1：PageModel、适配器接口和脱敏采集

### 6.1 类型契约

- [ ] 新建 PageModel、SectionModel、EntryModel、SemanticField、ControlGroup；
- [ ] ActionCandidate 区分 add/delete/save/next/submit/consent；
- [ ] StableRef 支持 frame、shadow root、CSS 路径、序号和结构签名；
- [ ] 当前值状态只记录 empty/non-empty/locked，不进入脱敏采集；
- [ ] 定义 adapter capability 接口，不使用单一字符串只做展示。

### 6.2 通用发现器

- [ ] 分区标题识别排除导航、步骤条和页脚；
- [ ] 基于 DOM 容器和视觉关系识别表单行；
- [ ] label 来源加入 ARIA、可访问性名称、前序兄弟、同列标题；
- [ ] 直接识别条目卡片和表格行；
- [ ] 识别一个语义字段对应的多个 input/select；
- [ ] 收集选项、required、maxlength、pattern 和错误提示；
- [ ] 标记 disabled/readonly/页面已有值；
- [ ] 长页面按分区扫描，不依赖当前视口。

### 6.3 脱敏采集器

- [ ] 设置页新增“诊断与采集”入口；
- [ ] 只导出结构、标签、选项、class 特征和动作类别；
- [ ] 清理字段值、文件名、手机号、邮箱、证件号、姓名和地址；
- [ ] 清理 URL 中的 token、operational、candidateId 等参数；
- [ ] 禁止读取 Cookie、localStorage、sessionStorage 和请求头；
- [ ] 导出前显示数据预览；
- [ ] 支持将采集结果转换为 fixture 骨架。

### 6.4 完成门槛

- 同一套 PageModel 能描述 Moka、Kuma 和 DayeeWT；
- 知乎教育区能识别两条教育卡片和每条卡片的控件组；
- 阿里“实习/项目经历”被识别为合并分区；
- 中国电信 100+ 控件按分区完整建模；
- 采集结果通过敏感信息扫描。

## 7. M2：规则候选、数据投影与 LLM 全分区规划

### 7.0 档案日期归一化

- [x] 文档抽取、备份导入和档案保存共用日期归一化入口；
- [x] 日期原子归一为 `YYYY`、`YYYY-MM` 或 `YYYY-MM-DD`；
- [x] 教育、工作/实习、项目和学生工作统一使用 `endDateIsNow`；
- [x] 档案编辑器显式展示“至今 / 进行中”开关；
- [x] 兼容迁移旧的拼接区间和全角/中文日期；
- [x] 无法可靠解析的旧值原样保留，不静默丢失。

### 7.1 规则候选

- [x] V2 规则只生成候选，不直接写页面；
- [ ] 所有信号、分区和类型兼容性加权后再应用阈值；
- [x] 置信度统一为 0~1；
- [x] 候选保留 top-N，而不是只保留单一 best；
- [ ] 加入控件类型、选项和条目类型约束；
- [ ] 对锁定字段返回 skip；
- [ ] 对已有非空字段默认返回 preserve。

### 7.2 数据投影

- [x] 实现结构化日期拆分、区间和“至今”（执行读回归 M3）；
- [ ] 实现地区拆分和国家码；
- [ ] 实现工作/实习拆分；
- [ ] 实现实习/项目合并；
- [ ] 实现奖项、竞赛、论文的摘要转换；
- [ ] 实现国家奖学金、学生干部等派生布尔值；
- [ ] 实现枚举同义转换；
- [ ] 未提供数据时返回 missing，不让 LLM补造。

### 7.3 LLM 规划器

- [x] 按分区构造请求；
- [x] 每个请求携带 entryId、fieldId、controlKind、选项和规则候选；
- [x] 启用 API 时复审全部 eligible 字段；
- [ ] 输出严格 JSON Schema；
- [x] 支持 keep-rule/replace-rule/fill/manual/skip；
- [x] 支持选择白名单 transform；
- [ ] 校验 path、条目下标、类型和敏感策略；
- [x] 某分区失败时继续其他分区；
- [ ] 缓存同站点字段签名对应的语义计划；
- [ ] 记录 LLM 输入字段数量、输出决策和被本地拒绝的原因。

### 7.4 隐私

- [x] `labels-only` 不包含 Profile 值；
- [x] `with-values` 对 restricted/sensitive 值强制掩码；
- [x] 请求发送前进行最终 payload 审计；
- [ ] 文档导入实现脱敏或显式授权；
- [x] 测试断言敏感值从未出现在 mock LLM 请求体。

### 7.5 完成门槛

- 150 字段页面全部进入对应分区规划；
- LLM 能纠正规则错配，也能主动选择 split/merge/derive；
- 规则和 LLM 结果可分别查看；
- LLM 不可用时，高置信规则路径仍能执行；
- 所有未确认事实保持为空。

## 8. M3：可验证控件执行器

### 8.1 文本与富文本

- [x] React/Vue/Angular 受控输入使用原生 setter 和 input/change/blur 事件；
- [ ] 写入后等待框架渲染并重新定位；
- [x] maxlength 截断必须标记 manual review；
- [x] 富文本读取编辑器实际内容，不只读输入值前缀；
- [x] disabled 字段直接跳过。

### 8.2 原生与镜像 select

- [x] 原生 select 按 value/text/同义词选择；
- [x] Bootstrap selectpicker 同时校验底层值和存在时的可见镜像；
- [x] 自定义 select 读取已选项而不是输入框文本；
- [ ] 多选控件逐项验证。

### 8.3 搜索式 combobox

- [x] 建立 trigger 与 aria-controls/Portal 弹层关联；
- [ ] 等待加载状态结束；
- [x] 只在关联弹层中搜索选项；
- [x] 点击后等待已选状态出现；
- [ ] 区分必须选中与允许自由输入；
- [x] 失败时发送 Escape 并报告，不把搜索文字计为选中。

### 8.4 日期

- [x] 单日、年月、日期区间；
- [x] 开始年/月 + 结束年/月；
- [ ] 单年/月；
- [ ] 日历弹层；
- [x] “至今/在读”；
- [x] 每部分读回。

### 8.5 重复条目

- [ ] 直接数 entry container；
- [ ] add 动作后验证条目数增加；
- [ ] 工作、实习、项目和合并分区正确路由；
- [ ] 运行第二次不新增重复条目；
- [ ] 删除动作永不自动触发。

### 8.6 执行报告

- [x] 分离 mapped/written/committed/verified；
- [x] 失败分类为 semantic/control/validation/stale-ref；
- [ ] 报告未匹配字段具体标签和分区；
- [x] V2 报告不携带 Profile 值；
- [x] 页面状态明确显示“尚未保存/提交”。

### 8.7 完成门槛

- raw input value 不再被当作搜索下拉成功；
- 所有 verified 项重新扫描后仍存在；
- 状态统计与页面实际一致；
- 安全动作零点击测试通过。

## 9. M4：MokaAdapter

### 9.1 实现范围

- [x] 知乎 Moka 标签节点；
- [x] 侧边导航与实际分区标题区分；
- [x] 教育/项目/获奖卡片容器；
- [x] 学校、专业、学历远程搜索下拉；
- [x] 年/月和区间日期；
- [x] “至今”开关；
- [x] 项目职责与项目描述区分；
- [x] Moka Portal 弹层关联和选中状态读取。

### 9.2 验收

- [x] fixture 全绿；
- [ ] 知乎真实页面只填不保存；
- [x] 规则阶段、LLM阶段和执行阶段分别可观察；
- [x] 学校/专业均真正选中，页面不残留弹层（fixture）；
- [x] 教育、项目和获奖日期正确（fixture）；
- [x] 无多余卡片，重复准备保持幂等（fixture）；
- [x] 保存按钮未点击（安全动作测试）。

## 10. M5：DayeeWTAdapter

### 10.1 平台特征

- URL/DOM 特征：`/wt/<tenant>/web`、`hotjob.cn`、`wtspe-*`、`ng-*`、
  `selectpicker`、`dayType`；
- 目标样本：中国电信、伊利、九江银行、中国人寿/广发、中广核；
- 该适配器优先级高于单独逐银行适配。

### 10.2 实现范围

- [x] `.ipt-item` 表单行和独立标题节点；
- [x] 原生 select + Bootstrap 镜像状态校验；
- [x] `dayType` 日期；
- [ ] 省/市级联双 select；
- [x] `增加更多`链接只按缺失条目数触发；
- [x] 每分区保存按钮识别但禁止点击；
- [ ] 中英文简历切换动作识别但禁止自动触发；
- [x] 100+字段分区批处理不截断；
- [ ] 高中、家庭、亲属回避、奖惩、论文、专利和附件分区。

### 10.3 验收

- [x] Dayee WT 结构测试覆盖 120 控件且不截断；
- [ ] 至少一个银行公开表单 fixture 通过；
- [ ] 至少一个央企公开表单 fixture 通过；
- [ ] 中国电信登录后真实页只填不保存验证；
- [x] selectpicker 底层值和存在时的可见镜像一致；
- [x] 分区保存、暂存、提交动作零点击。

## 11. M6：KumaAdapter

### 11.1 实现范围

- [x] `.kuma-uxform-field-core` 行结构；
- [x] `.kuma-select2` 搜索下拉；
- [x] Kuma readonly 日期；
- [x] 图标 + 文本形式的添加动作；
- [x] 分区保存按钮识别但禁止点击；
- [x] “实习/项目经历”按经历数 + 项目数合并路由；
- [ ] 奖励与荣誉聚合文本；
- [ ] 国家奖学金、保送、交换生等派生值；
- [ ] 论文等级/数量等特定投影；
- [ ] 多附件入口保持 manual。

### 11.2 验收

- [x] fixture 全绿；
- [ ] 阿里真实页面只填不保存；
- [x] 搜索下拉、日期和合并经历路由通过读回/断言（fixture）；
- [ ] 聚合文本不超长、不编造；
- [x] 多个分区保存/选择职位按钮均未点击。

## 12. M7：BeisenAdapter 与 GenericAdapter

### 12.1 Beisen 前置条件

- [ ] 用户提供登录后的真实北森简历页；
- [ ] 运行脱敏采集并人工审核；
- [ ] 确认 iframe 层级、组件库和跨 frame 消息路径；
- [ ] 生成真实结构 fixture。

未满足以上条件时，Beisen 保持 research 状态。

### 12.2 GenericAdapter

- [ ] 标准 label + 原生控件；
- [ ] Ant Design、Element、Arco 常见能力；
- [ ] 未识别组件降级为 manual，不直接猜写；
- [ ] iframe 内 content script 可独立建模；
- [ ] background 聚合 frame 结果；
- [ ] Shadow DOM 在可访问时纳入扫描。

### 12.3 验收

- 北森至少一个登录后真实页面通过；
- Generic 在未知站点不会点击保存/提交；
- 无法验证的自定义组件明确标黄 manual。

## 13. M8：产品化、性能与发布

### 13.1 UI

- [x] 设置页展示适配器成熟度；
- [x] “仅扫描表单”同时展示 V2 适配器、成熟度、分区/条目/字段数和禁止动作数；
- [ ] 用户可选择是否覆盖页面已有值；
- [ ] LLM 请求前显示隐私模式和字段数量；
- [ ] 诊断报告支持导出脱敏版本；
- [x] 文档导入明确披露“文件本地解析、解析文本发送给配置的 API”，并要求逐次确认。

### 13.2 性能

- [ ] 按分区懒扫描；
- [ ] Portal/MutationObserver 限定作用域；
- [x] 小分区合并至每批最多 80 字段，最多 3 批并发；单批 60 秒超时后回退规则；
- [ ] 语义计划缓存按适配器版本失效；
- [ ] 不因全页 MutationObserver 持续占用 CPU。

### 13.3 安全与发布

- [x] 检查 manifest 权限，移除与现有流程重复的 `activeTab`；
- [ ] 日志和错误报告脱敏；
- [ ] 生产包扫描真实姓名、电话、邮箱、证件号和 token；
- [x] README/设置页区分 research、fixture-verified 和 live-verified；
- [ ] 完成隐私说明和故障排查文档；
- [ ] 生成发布候选包并完成真实页面回归。

## 14. 测试矩阵

### 14.1 单元测试

- label 与分区识别；
- 条目容器和下标；
- 候选评分与类型约束；
- LLM 输出校验；
- 敏感值脱敏；
- split/merge/derive/aggregate 转换；
- URL 和快照脱敏。

### 14.2 组件契约测试

- 文本受控组件；
- 原生/Bootstrap/自定义 select；
- 搜索 combobox；
- 级联选择；
- 所有日期形态；
- 富文本；
- 重复条目；
- disabled/readonly；
- stale ref 重定位。

### 14.3 E2E

- 银行原生 fixture；
- Moka 真实结构 fixture；
- DayeeWT 真实结构 fixture；
- Kuma 真实结构 fixture；
- Beisen fixture（取得样本后）；
- LLM 正常、超时、空返回、非法 path、敏感 path；
- 150 字段长页面；
- 二次运行幂等；
- 全部安全动作零点击。

### 14.4 真实页面验收记录

每次记录：

- 日期和扩展版本；
- 页面 URL 模板和适配器版本；
- 分区/条目/字段数量；
- 规则与 LLM 决策；
- verified/manual/failed；
- 未保存、未提交的证据；
- 不记录具体简历值。

## 15. 风险与应对

| 风险 | 应对 |
|---|---|
| 站点改版 | 结构签名失效后降级 manual；采集器快速生成新 fixture |
| LLM 幻觉 | path/entry/transform 白名单校验，缺失值禁止生成 |
| LLM 成本和延迟 | 分区批次、字段签名缓存、规则候选压缩 |
| 自定义组件未真正提交 | authoritative readback，输入文字不算成功 |
| 误建重复条目 | 直接识别 entry container，二次运行幂等测试 |
| 超长银行/国企表单 | 按分区处理，不设全页前60项硬截断 |
| 敏感值外发 | payload 审计、敏感路径强制掩码、请求测试 |
| 登录页/验证码 | 不处理，等待用户进入简历编辑页 |
| 北森缺少真实样本 | 保持 research，不提前宣称支持 |
| fixture 与真实页漂移 | live-verified 门槛和定期实页回归 |

## 16. 每个里程碑的通用完成定义

一个里程碑只有在以下条件全部满足时才完成：

1. 类型检查、构建和相关测试通过；
2. 新增行为有失败前/成功后的回归测试；
3. 页面实际状态与报告一致；
4. 没有真实个人数据进入仓库或日志；
5. 保存、下一步、声明和提交动作未被触发；
6. 文档同步更新；
7. 对应真实页面验收门槛已满足，或明确标为尚未 live-verified。

## 17. 第一轮开发切片

为避免大爆炸式重写，第一轮只交付以下闭环：

1. PageModel 最小类型；
2. Moka 教育分区的真实结构识别；
3. 规则候选与 LLM 全分区规划；
4. Moka 学校/专业搜索下拉状态机；
5. Moka 年/月四控件日期；
6. verified 状态与新报告；
7. 知乎真实页面只填不保存验收。

该切片通过后，再把同一核心模型扩展到 DayeeWT 和 Kuma，不先并行堆叠三个独立实现。

## 18. M9：LLM-First Agent 重构

详细架构见 [AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md)。本阶段取代继续堆叠站点特例。

### 18.1 A1 Agent 合同

- [ ] AgentField / AgentControlGroup / AgentFact；
- [ ] ToolCall / ToolResult / AgentTrace；
- [ ] provider capability：native-tools / json-tools / mapping-only；
- [ ] 每字段强制终态和漏项检测；
- [ ] 保存/下一步/提交工具不存在的类型级断言。

### 18.2 A2 通用观察能力

- [ ] 复合表单行拆分；
- [ ] 单日期、年月、年月日、区间、四段/六段日期和 current toggle；
- [ ] 动态 Portal 与 trigger 关联；
- [ ] 结构相似重复条目发现；
- [ ] 合并分区本地 route table；
- [ ] opaque class 和随机嵌套 fixture。

### 18.3 A3 语义工具网关

- [ ] inspect_section / inspect_control / inspect_options / inspect_entries；
- [ ] fill_text_from_fact；
- [ ] select_option_from_fact；
- [ ] fill_date_from_facts；
- [ ] set_boolean_from_fact；
- [ ] ensure_entries；
- [ ] verify_field / verify_section；
- [ ] 所有工具本地路径、类型、敏感和动作安全校验。

### 18.4 A4 Agent 循环

- [ ] 首轮批量工具计划；
- [ ] 工具执行结果回传；
- [ ] 最多两轮 repair；
- [ ] 缺失字段重试一次后 manual；
- [ ] provider native tool calling 与 JSON tool envelope 兼容；
- [ ] 典型页面不超过两轮模型调用。

### 18.5 A5 可观察性和 shadow mode

- [ ] 规则 hints、LLM calls、tool calls、rejections、repairs 分开显示；
- [ ] Agent shadow mode 不写页面；
- [ ] 与当前 V2 对比 mapped/verified/错误类型；
- [ ] 报告不包含完整敏感值。

### 18.6 A6 泛化验收

- [ ] 随机 class/嵌套深度；
- [ ] 复合证件与电话行；
- [ ] 日期形态组合矩阵；
- [ ] 多 Portal 并存和失败清理；
- [ ] 奖项/教育/项目多条目无重复；
- [ ] Moka、Dayee WT、Kuma 分别通过 live gate；
- [ ] 全部保存/提交动作零点击。
