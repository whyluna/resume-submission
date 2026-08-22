# 秋招简历自动填写 Chrome 插件 — 调研与详细设计

> 版本：v0.1（设计稿，待决策后进入开发）
> 日期：2026-08-22
> 历史状态：本文件记录早期模拟表单方案。真实站点调研后的现行需求与开发路线见
> [REQUIREMENTS.md](./REQUIREMENTS.md) 和 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md)；
> 冲突内容以两份 v0.2 文档为准。

---

## 第一部分：调研结论

### 1.1 秋招网申到底要填什么

国内校招网申系统按行业分两类，**银行/国企/央企/券商的网申是字段超集**，互联网大厂是其子集加少量特色字段。

#### A. 个人基本信息（所有系统都有）

| 字段 | 说明 |
|---|---|
| 姓名 / 姓 / 名 / 英文名 | 部分外企系统拆开问 |
| 性别 | 常为 radio |
| 出生年月 | 日期控件 |
| 民族 / 国籍 | 下拉 |
| **政治面貌** | 党员/预备党员/共青团员/群众/民主党派，国企银行必填 |
| 证件类型 + 证件号码 | 身份证/护照，部分要求身份证 |
| 手机 / 邮箱 / 微信号 / QQ | |
| **籍贯 / 生源地 / 户口所在地 / 现居住城市** | 三个概念不同，国企常同时出现 |
| 婚姻状况 | 银行常见 |
| 身高 / 体重 / 血型 / 健康状况 | 银行、航空、部分国企 |
| 证件照上传 | 文件上传控件 |
| 紧急联系人及关系、电话 | 外企/银行常见 |
| 兴趣爱好、个人主页/博客/GitHub | 互联网常见 |

#### B. 教育经历（多条，常要求从高中/本科填到最高学历，"由低到高"）

- 学校、城市、学院/院系、专业
- 学历（本科/硕士研究生/博士研究生）、学位（学士/硕士/博士；工学/理学…）
- 起止时间（在读/至今）
- 学习形式：全日制/非全日制；教育类型：统招/自考/成人…
- **学校类别**：985/211/双一流/QS 排名（部分系统是下拉，部分是隐式校验）
- GPA / 成绩（X/4.0）、专业排名（前 N%）、排名（5/120）
- 主修课程、研究方向、毕业论文题目
- 录取批次（本科批次）、是否最高学历、是否海外学历、学历证书编号
- 部分银行要求**高考成绩、生源地高中**

#### C. 实习经历 / 工作经历（多条）

- 公司名称、城市、部门、职位、起止时间
- 工作内容/职责描述（**常见富文本编辑器**，字数限制 200/500/1000 不等）
- 业绩/成果、离职原因（社招/银行）
- 实习经历常额外问：实习时长、是否可转正、导师姓名

#### D. 项目经历（多条）

- 项目名称、担任角色、起止时间、项目链接/GitHub
- 项目描述、个人职责/贡献、成果、技术栈/技能标签

#### E. 科研/论文（硕博常见，部分系统独立分区）

- 论文题目、期刊/会议名、发表时间、作者排序（第几作者）、链接、检索（SCI/EI）

#### F. 竞赛/获奖/荣誉（多条）

- 奖项名称、**级别**（国际/国家/省级/市级/校级）、**奖项等级**（一等奖/金奖/优胜奖…）、获奖时间、团队规模、个人角色
- 奖惩情况：国企银行单独问"是否受过处分"（是/否 + 说明）

#### G. 学生工作 / 社团 / 社会实践（多条）

- 组织名称、职务、起止时间、工作内容

#### H. 语言 / 计算机 / 证书

- 语言：语种、熟练程度、证书（CET-4/6 **及分数**、托福/雅思及分数、普通话等级）
- 计算机：等级证书、编程语言及熟练度、办公软件
- 其他证书：CPA/法考/驾驶证(C1)等，证书名称+颁发机构+时间

#### I. 求职意向

- 期望城市（多选）、期望职位/事业群（腾讯 BG、华为 OD 方向）、期望薪资（月薪/年薪/区间）
- 到岗时间、可实习时长（每周几天/几个月）、是否接受调剂/出差/外派

#### J. 家庭情况（银行/国企/券商几乎必填）

- 成员表格（多条）：称谓/关系、姓名、年龄或出生年月、工作单位、职务、政治面貌、联系电话
- 亲属回避情况（是否有亲属在本单位任职）

#### K. 自我评价 + 开放性问题

- 自我评价/个人优势：文本域，常限 200~500 字
- 开放题（各家相似度极高，值得沉淀答案库复用）：
  - 为什么选择我们公司/这个行业/这个岗位？
  - 最有成就感的一件事 / 最大挫折及如何克服？
  - 你的优缺点 / 职业规划 / 与岗位的匹配点？
  - 能接受的工作强度？如何看待加班？

#### L. 其他

- 简历附件上传（PDF/DOCX）、成绩单附件、证件照
- 信息真实性声明 checkbox、内推码
- 验证码（不做自动处理）

> 结论：**数据模型必须覆盖 A–L 全部分区**，其中多条目分区（教育/实习/工作/项目/竞赛/学生工作/家庭成员）是结构主干。

### 1.2 招聘系统生态（决定我们要适配的 DOM 形态）

| 系统 | 域名特征 | 使用方（部分） | 表单技术形态 |
|---|---|---|---|
| **Moka** | `app.mokahr.com/apply/<公司>/…`、`campus_apply` | 知乎、B站、快手、蔚来、理想、小红书、米哈游及大量中小公司 | React 单页、自定义组件库（非原生 select）、日期选择器、多条目"继续添加"按钮、**多页 step 表单** |
| **北森 iTalent** | `*.italent.cn`、`career.beisen.com` | 京东系、大量国企/央企/券商 | **iframe 嵌套重**、租户自定义字段多（字段名千奇百怪）、有测评联动 |
| **牛客网** | `hr.nowcoder.com` / `www.nowcoder.com` | 部分公司内推页 + 自身投递 | Vue、组件化表单 |
| **大易 Dayee** | `*.dayee.com` | 滴滴等 | 老式页面 + 组件混合 |
| 智联/前程无忧 | `zhaopin.com`、`51job.com` | 银行外包、部分央企 | 老式 DOM，相对好填 |
| 自研系统 | `jobs.bytedance.com`（字节）、`join.qq.com`（腾讯）、`talent-holding.alibaba.com`（阿里）、`career.huawei.com`（华为） | 大厂 | 各家框架（React/Vue），字段多、开放题多、多页 step |

共同难点（开源项目反复提到）：
1. **iframe 嵌套**（北森为最）——content script 必须 `all_frames` 并做跨 frame 路由；
2. **自定义控件**：非原生 select（点击展开面板再选）、日期选择器（antd/Element/Arco 各家）、**级联选择**（省/市/区拆分填写）、富文本编辑器（经历描述）；
3. **React/Vue 受控组件**：直接 `input.value = x` 不生效，必须走原生 setter + 合成 `input`/`change` 事件；
4. **多条目动态添加**："添加教育经历/新增一条/继续添加"按钮 → 点击后 MutationObserver 等新 DOM 出现再填；
5. **多页 step 表单**：填完一页要点"保存并下一步"；
6. 字段异构：同一概念几十种问法（学校/院校/毕业院校/就读学校…），租户自定义字段名不可枚举 → 必须语义匹配；
7. 网申**无自动保存**，误操作代价高 → 更要"只填不提交"。

### 1.3 开源项目分析

| 项目 | 方案 | 对我们的参考价值 | 弱点 |
|---|---|---|---|
| **OpenJobAutofill**（Br1an67，2026-05 自荐于 ruanyf/weekly #9881） | 本地规则 + AI 辅助两阶段；隐私优先：**LLM 只看字段对应关系、不看真实值**，取值写入全在本地；本地存储；置信度机制（只自动填高置信度项）；Profile 分 15 个分区（basic/教育/实习/工作/项目/学生工作/奖项/语言/计算机/证书/家庭/自我评价/声明/其他 + 自定义分区），条目用**中文字段名→值**的宽松 KV 结构 + 别名机制 | 与本需求重合度最高的项目；其 Profile 分区设计、"labels-only" 隐私模式、置信度策略、站点适配器打分（URL pattern + score + confidence）可直接借鉴 | 下拉框/日期组件适配差（README 自己承认）；多页表单每页需手动再点一次；**不自动点"添加"按钮**（多条经历会挤错位）；无文档导入解析 |
| **auto-fill-resume**（erdayi，MV3） | 纯规则：提取 name/id/label/placeholder 等 **15+ 信号**，与 **50+ 字段匹配器**加权评分，阈值 ≥8 判定匹配；原生 prototype setter + 合成事件适配 React/Vue；按容器分组填写多条目；**自动点击"添加"按钮创建新条目**；适配 antd/Element/Arco 日期与下拉；Alt+Shift+F 快捷键；JSON 导入导出 | 规则引擎的天花板参考：信号提取+加权评分+阈值，以及"分组容器识别 + 点添加按钮"的完整实现路径 | 无 LLM（遇到没见过的字段名就放弃）；知名度低（star≈1）但代码结构干净 |
| **OnceResume**（28H2O2） | 逐站硬编码选择器 | 反面教材：**逐站硬编码不可扩展**（只适配了字节少量字段就停滞） | 无通用匹配、无 LLM |
| **cv-helper**（AD-milk） | 手动配置 + 快捷键把内容粘贴到聚焦输入框 | 极简兜底思路：单字段手动粘贴，可作为"逐字段辅助"模式 | 一切靠手动 |
| **get_jobs / find-job**（loks666 等） | 自动投递/自动打招呼（Boss 直聘等） | 超出本需求范围（我们是"填写辅助"不是"无人投递"）；其风控意识可参考 | — |
| **ApplyAI**（国外，dev.to 文章） | 把表单字段 JSON 发给 AI Agent，返回 **fill plan**（结构化填写计划）再执行 | "fill plan" 与 OpenJobAutofill 的"AI 返回字段对应关系"同构，验证了这是 LLM 填表的正确形态 | 面向西方 ATS（Workday 等） |
| **Autofill-Jobs**（andrewmillercode） | Vue 扩展，面向西方 ATS | 西方字段模型参考（EEO、work authorization 等） | 不适用国内 |

### 1.4 商业产品对标（功能基准线）

- **OfferNow 简历闪填**：语义分析 + AI 识别一键填写（ruanyf/weekly #8577）
- **塔塔网申**：本地 AI 推理 + **云端规则库**协同；其博客直言市面插件多为"伪自动填充"（要手动匹配字段、识别错乱）——说明**匹配准确率是核心竞争力**
- **TalenCat 网申助手**：一键填写 + **网申开放题答案生成**
- **超级简历·超级网申**：与在线简历数据实时同步
- **牛客网申助手**（实测帖"32 分钟投 18 家"）：提前在牛客完善结构化简历 → 一键填入
- 国外：Simplify、JobWizard、SpeedyApply（面向 Workday/Greenhouse/LinkedIn）

商业产品验证了两点：①"结构化档案 + 一键填写"是真需求、可商用；②开放题 AI 草稿是普遍的增值功能。

---

## 第二部分：详细设计

### 2.0 设计原则

1. **只填不提交**：永不点击"提交/投递/确认提交"类按钮；提交永远留给用户。
2. **匹配准确率 > 覆盖率**：高置信度自动填并标绿；低置信度不填、标橙并列在报告里等用户确认——错填比漏填伤害大（网申无自动保存）。
3. **规则优先、LLM 兜底、记忆加速**：规则引擎解决 80% 常见字段（零成本、零延迟、可离线）；LLM 解决长尾字段名；成功映射按站点记忆，二次投递零成本直填。
4. **隐私分级**：默认只把"字段标签/选项文本"发给 LLM，简历值不出本机；敏感字段（身份证、证件照、家庭成员电话）永不外发。
5. **通用引擎 + 站点补丁**：通用语义匹配打底，对 Moka/北森/牛客/大易/主流自研站做定向适配（组件级 patch），不逐站写死字段选择器（OnceResume 的教训）。

### 2.1 总体架构

```
┌───────────────────────────────────────────────────────────────┐
│ Chrome Extension (Manifest V3, TypeScript)                    │
│                                                               │
│  Options 页 (React)          Popup (React)                    │
│  ├─ 简历档案编辑器(15分区)     ├─ 检测当前站点                  │
│  ├─ 文档导入向导(PDF/DOCX)    ├─ 选择档案 → 「开始填写」        │
│  └─ API/隐私/规则设置         └─ 进度与结果摘要                 │
│         │                          │                          │
│         ▼                          ▼                          │
│  ┌───────────────── Background Service Worker ─────────────┐  │
│  │  LLM 网关(OpenAI 兼容, fetch, 重试/超时/JSON约束)         │  │
│  │  站点记忆库(siteKey→字段映射缓存)  消息路由(frameId)      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │ chrome.tabs.sendMessage(frame)      │
│  ┌───────────────── Content Script (all_frames) ────────────┐  │
│  │  表单扫描器 → FormSnapshot (穿 iframe/ShadowDOM)          │  │
│  │  匹配引擎: 记忆层→规则层→LLM层 → FillPlan                 │  │
│  │  执行器: 控件 setters / 组件适配 / 点「添加」按钮 / 翻页   │  │
│  │  UI: 侧栏进度面板 + 字段高亮(绿/橙/黄) + 结果报告          │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### 2.2 简历数据模型（Profile Schema v1）

采用「结构化强类型字段 + 分区自定义 KV + 原始文本」三层（吸收 OpenJobAutofill 的 15 分区，但字段强类型化便于校验和 LLM 抽取目标明确）：

```ts
interface Profile {
  schemaVersion: 1
  id: string; name: string            // 多档案支持：技术岗版/银行版
  basic: Basic                        // §1.1-A 全字段（含籍贯/生源/户口三区分）
  intention: Intention                // 期望城市/职位/薪资/到岗时间/可实习时长/是否接受调剂
  educations: Education[]             // A 节 B：学校类别(985/211/双一流/QS)、GPA、排名、主修课程…
  experiences: Experience[]           // 实习+工作合并，type 区分：company/dept/title/desc/achievements
  projects: Project[]                 // name/role/desc/contribution/techStack/url
  papers?: Paper[]                    // 硕博：题/期刊/作者排序/链接
  competitions: Competition[]         // name/level(国省校)/award(等级)/date/role
  awards: Award[]                     // 荣誉（奖学金等）：name/level/date
  studentWork: OrgExperience[]        // 学生工作/社团/社会实践
  languages: Language[]               // CET4/6+分数、托福雅思、普通话
  itSkills: { skill: string; level: 1|2|3|4 }[]
  certificates: Certificate[]         // 驾照/CPA/法考…
  familyMembers?: FamilyMember[]      // relation/name/company/position/phone/politicalStatus
  selfEvaluation: string              // 自我评价原文
  openAnswers: { tags: string[]; question: string; answer: string }[]  // 开放题答案库(可复用)
  extras: { label: string; value: string }[]   // 自定义 KV 兜底（身份证号等敏感项默认放这并加密标记）
  raw?: { fullText: string; sourceFileName: string }  // 导入的简历原文（供 LLM 二次抽取）
}
```

要点：
- **敏感字段白名单**：`idNumber、familyMembers[*].phone、photo` 标记 `SENSITIVE`，任何 LLM 请求都不携带其值；
- 条目支持「启用/停用」开关——投互联网时停用家庭信息区，投银行时启用；
- 导入/导出 JSON 备份；`chrome.storage.local` 存储永不离开设备。

### 2.3 文档导入与 LLM 解析管线（设置页）

```
上传 PDF/DOCX
  ├─ DOCX → mammoth.js 转 HTML→文本（保留标题层级）
  ├─ PDF  → pdf.js 提取文本层
  │    └─ 文本密度过低(扫描件/设计型排版) → pdf.js 渲染页图 → 视觉模型(VLM)识别
  ├─（可选）PDF 直接走 VLM：双栏/表格型简历抽取更稳（成本高，用户可关）
  ▼
预清洗：去页眉页脚/页码/断行拼接/全半角归一
  ▼
LLM 结构化抽取（OpenAI 兼容 chat completions，JSON Schema 约束输出）
  ├─ Prompt 附带完整 Profile schema 字段说明 + few-shot
  ├─ 长简历分块抽取后合并（教育/经历分区各自独立抽取，避免上下文溢出）
  └─ 抽取结果带 confidence + 原文出处定位（便于校对）
  ▼
校对 UI：左侧原文高亮对应段落，右侧表单逐字段确认/修改 → 存入 Profile
```

- API 设置：`baseURL + apiKey + model`（兼容 DeepSeek/GLM/Qwen/OpenAI/本地 Ollama），连通性测试按钮；
- 未配置 API 时：DOCX/PDF 文本抽取后进入**纯手动**编辑（规则填写引擎完全不受影响）。

### 2.4 表单扫描器（FormSnapshot）

content script 对当前页（含所有 frame、穿 Shadow DOM）生成快照：

```ts
interface FormSnapshot {
  frames: FrameInfo[]                        // frameId 层级
  groups: Group[]                            // 表单分区
}
interface Group {
  kind: 'simple' | 'repeat'                  // repeat=多条经历区
  sectionHint?: string                       // 分区标题文本："教育经历"…
  rootSelector: StableRef
  entrySlots: Field[][]                      // repeat 组：每个已存在条目一组字段
  fields: Field[]                            // simple 组字段
  addButtons: Candidate[]                    // "添加教育经历/新增/继续添加/+"
  nextButtons: Candidate[]                   // "保存并下一步/下一步"（仅记录，是否点由策略定）
}
interface Field {
  ref: StableRef            // 稳定引用：frame + CSS 路径 + 兜底序号（DOM 变化后可重定位）
  control: 'text'|'textarea'|'select'|'radio'|'checkbox'|'date'|'cascader'|'richtext'|'upload'|'unknown'
  signals: {                // 参考 auto-fill-resume 的多信号，供规则层加权
    label: string; labelNear: string[]      // label/显式绑定/左侧左侧文本/同行标题
    name: string; id: string; placeholder: string
    ariaLabel: string; title: string; classNameHint: string[]
    sectionText: string                     // 所在分区的标题链（"教育经历 > 硕士"）
    options?: string[]                      // select/radio/checkbox 的全部选项文本
    required: boolean; maxLength?: number; patternHint?: string
  }
  signature: string         // 归一化信号哈希 → 记忆层的 key
}
```

扫描时机：popup 点「开始填写」主动触发 + 填写过程中 MutationObserver 监听 DOM 增量（点了添加按钮后等新条目渲染稳定再扫）。

### 2.5 匹配引擎：三层流水线 → FillPlan

```
FormSnapshot + Profile
  ▼
①记忆层：siteKey(eTLD+1+路径模板) × field.signature → 之前成功过的 profilePath
    命中且 ref 仍可定位 → 直接采纳（confidence=0.95，零成本）
  ▼
②规则层：别名词典 + 信号加权评分（auto-fill-resume 方案的加强版）
    - 内置中文别名词典（每个 profile 字段 3~10 个别名，如
      学校：院校|毕业院校|就读学校|学校名称|university；
      手机：电话|联系电话|手机号码|mobile|phone…），预置 300+ 别名，用户可增补
    - 信号加权：label 精确匹配 100 / label 包含 60 / name|id|placeholder 匹配 40 /
      邻近文本 25 / sectionHint 交叉验证 ±20（"教育经历"分区里的"时间"≠工作起止时间）
    - 值兼容性校验：日期字段 vs 值格式、select/radio 的 options 是否容纳该值
      （如性别=男 且 options 含"男"）、maxLength 截断预警
    - score ≥ 高阈值 → confidence 0.9；中阈值 → 0.6（标橙待确认）；低于 → 交给 LLM
  ▼
③LLM 层（全量复审，任务B2 —— 不只兜底）
    触发：规则层跑完后，把「已匹配字段（含 path/得分/已填值）+ 未匹配字段」整体打包（≤60 个，
          页面已有值且未动过的字段不发给 LLM——尊重现状）
    请求：字段编号 + label/name/placeholder/分区与槽位提示（"教育背景 第2条"）+ options 前 12 项 + rule 结果
          + Profile 摘要（字段路径 + 中文标签 + 值；敏感字段恒掩码 ***）
    返回：[{"i":n,"op":"fill","path":...,"c":0.9,"why":...}]（补填未映射）+ op:"fix"（纠正规则错配，c≥0.75 才应用）
    约束：path 本地取值校验（防幻觉）；补填只作用于规则没处理过的字段；失败标橙不中断
  ▼
FillPlan = ①②③ 合并去重（置信度高者优先）
```

开放性问题字段：规则层识别到 textarea 且 label 命中开放题词库（"为什么选择/成就感/优缺点/职业规划"）→ 从 `openAnswers` 答案库按语义标签匹配候选；可选「AI 起草」（用 with-values 模式生成草稿，默认关）。

### 2.6 执行器

**控件写入矩阵**（全部遵循"先取焦点→写值→派发事件→读回校验"）：

| 控件 | 写入方式 | 说明 |
|---|---|---|
| text/textarea（React/Vue 受控） | `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v)` + 派发 `input`/`change` | 标准做法，两家开源已验证 |
| 富文本（contenteditable） | 聚焦后 `document.execCommand('insertText')` 或粘贴事件注入 | 经历描述常见 |
| 原生 select | `value=` 匹配（文本模糊匹配选项：前缀/包含/归一化）+ change | |
| **自定义下拉**（antd/Element/Arco/Moka 自研） | 点击展开 → 面板内匹配选项文本 → 点击；**搜索式下拉**（学校/专业等 type-to-search）：点开无选项时自动改为 输入→等联想→点选匹配项，未出联想 Enter 确认、失败保留原值标橙 | 两条路径都基于通用选项选择器（`li[role=option]`、`[class*=option-item]`…），不绑定组件库 |
| **普通输入框 + 联想**（未被识别为组件） | 写入后 250~900ms 内出现匹配联想项则自动点选 | Moka 搜索式下拉兜底路径 |
| radio | 按值匹配 label 文本点击（男/女、是/否、已婚/未婚、全日制…） | 值-选项同义映射表 |
| checkbox 组 | 逐项匹配勾选（主修课程/技能标签） | |
| 日期（单值） | 组件内 input 原生 setter + input/change/blur + 读回校验 | readonly 只挡用户键入 |
| **日期区间**（起止双 input，label"就读时间/起止时间"→伪字段 `__range`） | 值拆 "start ~ end" 分别写入两框；end=至今 → 勾选同表单行的「至今」复选框 | |
| **级联（省市区）** | 值拆分（"广东省 广州市 天河区"）逐级选择 | 行政区划拆分器 |
| upload（证件照/附件） | **P1**：`DataTransfer` 注入 File（照片从档案 dataURL 构造）+ change；失败则标黄提示手动上传 | 有站点校验风险，默认开提示不开注入 |

**多条目（repeat 组）流程**：
1. 识别分组容器（分区标题"教育经历/实习经历…"聚类）；
2. 比较 `Profile.educations.length` 与现有槽位数；
3. 槽位不足 → 点击 addButtons（文本匹配：添加/新增/继续添加/新增一条/＋）→ MutationObserver 等新槽位渲染稳定（300ms 无变更）→ 继续填下一条；
4. 条目按时间排序对应（教育经历多数站点要求"由低到高"或"由高到低"，按页面现有槽位顺序自适应）。

**多页 step 表单**：填完当前页 → 侧栏提示「本页完成 N 项，待确认 M 项」；策略可选（见决策点 C）：默认**半自动**（用户核对后自己点"下一步"，插件自动开始填下一页）；可开"自动翻页"连续填写，但遇"提交/确认投递"一律停下。

**填写节奏**：字段间 50~200ms 随机延迟 + 模拟真实输入（长文本分段输入），避免行为检测误伤（我们是单用户辅助工具，不做并发批量）。

**结果报告（侧栏）**：
- ✅ 绿色高亮：高置信度已填（N 项），列表可点击定位、一键回滚单项；
- 🟠 橙色：低置信度已填或规则/LLM 意见冲突——列表呈现"填了什么/为什么"，用户点确认或改；
- 🟡 黄色：需要手动（上传、验证码、开放题草稿待改）；
- 汇总："成功 23 / 待确认 5 / 需手动 2 / 未匹配 1"，一键「复制未填项清单」。

### 2.7 LLM 与安全设计

- **API Key** 存 `chrome.storage.local`，仅 background 使用；请求全部从 SW 发出（无 CORS 问题）；
- **隐私三档**：`off`（纯规则）/ `labels-only`（默认，只发字段标签与选项）/ `with-values`（发值，用于改写/开放题草稿，显式开启+红字提示）；
- 敏感字段（身份证号、家庭成员电话、证件照）在**任何模式**下都不外发；
- MV3 合规：pdf.js/mammoth/词典全部打包进扩展，无远程代码；
- Service Worker 冷启动：LLM 长调用期间用消息心跳保活，结果落盘可断点续跑。

### 2.8 工程结构

```
resume-submission/
├── DESIGN.md
├── package.json / tsconfig / vite.config.ts(@crxjs/vite-plugin)
├── src/
│   ├── manifest.config.ts             # MV3: content(all_frames)+SW+options+popup+快捷键
│   ├── shared/                        # types(profile/snapshot/plan) · 消息协议 · 归一化工具
│   ├── background/                    # llm-gateway · site-memory · 路由 · 心跳
│   ├── content/
│   │   ├── scanner/                   # DOM→FormSnapshot（iframe/ShadowDOM/分组/按钮候选）
│   │   ├── matcher/                   # aliases.ts(300+) · rules.ts · llm-client · planner.ts
│   │   ├── executor/                  # setters · widgets(antd/element/arco/moka) · repeat.ts · pager.ts
│   │   └── ui/                        # 侧栏面板 · 高亮 · 报告
│   ├── options/                       # React：档案编辑 · 导入向导 · API/隐私设置
│   ├── popup/                         # React：检测→开始→进度
│   └── lib/                           # pdf.ts(pdf.js) · docx.ts(mammoth) · extractor(LLM 抽取)
└── e2e/fixtures/                      # 本地 mock 站点：Moka风格/北森iframe风格/牛客风格/银行全字段
```

**测试策略**：`e2e/fixtures` 用静态页模拟各系统 DOM 形态（含 iframe 嵌套、antd 组件、多条目添加、多页 step、银行全字段表单），规则引擎与执行器全部可离线回归；真实站点（Moka/北森/牛客/字节/腾讯）用测试档案人工冒烟。

### 2.9 里程碑

| 阶段 | 内容 | 验收标准 | 状态 |
|---|---|---|---|
| **M0 骨架+规则引擎** | 工程搭建、档案手动编辑+导入导出、扫描器、规则匹配（别名+加权）、执行器（text/select/radio/checkbox/日期）、repeat 添加按钮、高亮+侧栏报告 | 本地 mock 站点：银行全字段表单 80% 字段正确填入，多条教育经历自动添加填写成功 | ✅ 2026-08-22 完成，41 项 E2E 断言全绿 |
| **M1 文档导入+LLM** | API 配置、PDF/DOCX 导入解析、LLM 结构化抽取+校对 UI、LLM fill-plan 兜底、labels-only 隐私模式 | 真实 PDF 简历导入 → 校对后填写 mock 页新增字段命中率 ≥ 规则单独时的水平 | ✅ 2026-08-22 完成；真实 DeepSeek（deepseek-v4-flash，32k tokens）用用户本人简历全链路冒烟通过 |
| **M2 站点打磨+记忆** | Moka/北森/牛客实测适配修复、站点记忆层、多页半自动、级联/富文本/上传注入、SW 保活 | 真实站点冒烟：字节(Moka)全流程填写成功；同站二次投递记忆命中 | ⏳ ①组件适配器 ✅（8 断言）；②知乎规则/搜索下拉/区间日期/LLM 全量复审 ✅ 2026-08-22（moka-resume 复刻页 19 断言；真实知乎投递表单需手机验证码登录，待用户带会话实测） |
| **M3 增值** | 开放题答案库+AI 草稿、多档案、投递记录统计 | — | ⏳ |

### 2.10 风险与对策

| 风险 | 对策 |
|---|---|
| 北森 iframe 深嵌套路由复杂 | content script `all_frames` + background 以 frameId 中转；快照带 frame 链 |
| 侧边导航/步骤条里的分区名劫持分区检测（知乎 Moka 简历页左侧菜单即"教育背景/项目经验…"） | 分区标题候选排除 nav/aside/menu/sidebar/step 容器；label 候选须含文字（纯图标/符号不算） |
| 自定义组件千奇百怪 | 组件适配器接口开放（widgets/*），社区可插拔；失败回落标黄而非硬写 |
| LLM 幻觉/超时/限流 | ref 白名单校验、JSON schema 约束、重试回落规则层、置信度门槛 |
| 站点改版导致记忆失效 | signature 校验 ref 仍存在，失效即重走规则/LLM |
| 网申无自动保存、误填代价高 | 只填不提交 + 高亮可回滚 + 待确认不自动填 |
| pdf.js/mammoth 体积 | 按需懒加载（导入时动态 import） |

### 2.11 已定稿决策（2026-08-22 用户拍板）

| 决策点 | 结论 | 影响 |
|---|---|---|
| A 技术栈 | **TypeScript + React + @crxjs/vite-plugin** | 强类型数据模型；React 写 options/popup/侧栏 |
| B MVP 站点 | **Moka + 北森 + 牛客三站一起**（M0 即做） | 北森 iframe 路由与牛客适配提前进 M0/M1；工期拉长但覆盖秋招主流 |
| C 多页表单 | **半自动**：填完一页侧栏提示，用户核对后自己点"下一步"，插件自动继续填下一页；遇"提交/投递"一律不碰 | — |
| D LLM 隐私默认档 | **with-values**（发送简历值，支持改写/截断/开放题草稿）；身份证号、家庭成员电话、证件照等敏感字段**任何模式下都不外发**；labels-only / 纯规则可在设置里随时切换 | — |

后续待议（默认按建议执行）：文档解析 VLM 视觉通道（P1，扫描件/双栏排版时启用）；证件照/附件 DataTransfer 注入上传（P1，默认关）；开放题 AI 起草（M3，默认关）。
