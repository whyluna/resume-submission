# 秋招简历自动填写（Chrome MV3 扩展）

填写一次简历，网申表单一键填入。**只填不提交**。产品目标覆盖 Moka、北森、用友大易、
企业自研页及通用招聘表单，采用规则引擎 + LLM（OpenAI 兼容 API）双驱动。

> 当前源码是 v0.1 原型，本地 fixture 通过不代表真实站点已经适配。真实知乎 Moka、阿里 Kuma、
> 中国电信用友大易等页面调研后的 v0.2 路线见 [需求文档](./REQUIREMENTS.md) 和
> [开发计划](./DEVELOPMENT_PLAN.md)。早期调研与设计记录保留在 [DESIGN.md](./DESIGN.md)。

## 功能

- **简历档案**：15 分区（基本/意向/教育/实习/项目/论文/竞赛/荣誉/学生工作/语言/证书/家庭/自我评价…）多档案管理，JSON 备份导入导出
- **文档导入**：上传 PDF / DOCX / TXT → 本地解析（pdf.js / mammoth，文件不上传）→ LLM 结构化抽取 → 左右对照校对 → 存为新档案；支持直接粘贴文本
- **文档导入隐私披露**：原始文件只在本地解析；发送解析文本给所配置的大模型 API 前必须逐次勾选确认。解析文本可能含个人信息，`off` 模式不会调用 LLM。
- **一键填写**：popup 或 **Alt+Shift+F**；规则引擎（200+ 中文别名词典+加权评分）优先，LLM 兜底映射没见过的字段；自动点击「添加教育经历/家庭成员」等按钮填多条目（支持默认空分区从零创建）；原生控件 + **自定义组件适配**（antd/Element/Arco/Moka 风格下拉、级联省市区、ant-picker 日期、Quill 富文本）；绿/橙/红高亮 + 侧栏报告，只填不提交
- **Moka V2（fixture-verified）**：Moka 页面默认使用全分区 LLM 复审和可验证执行器；搜索下拉必须点击真实选项并读回，日期区间/“至今”逐部分验证，重复条目只补缺口。真实知乎页仍需再次只填不保存验收后才能标记 live-verified。
- **Dayee WT V2（fixture-verified）**：识别中国电信/银行/国企常见 `.ipt-item`、`dayType`、`selectpicker` 和“增加更多”，支持 120 控件分区批处理；保存、暂存、提交始终禁止自动触发。真实中国电信页尚未标记 live-verified。
- **Kuma V2（fixture-verified）**：识别阿里 `.kuma-uxform-field-core`、`.kuma-select2`、readonly 日期和图标添加动作；合并的“实习/项目经历”会按两个档案数组分别路由。真实阿里页尚未标记 live-verified。
- **隐私分档**：with-values（默认）/ labels-only / 纯规则 off；身份证号、家庭成员姓名电话任何模式下不发给 LLM；API Key 仅存本机、仅 background 使用

## 开发与构建

```bash
npm install
npm run build        # 产物输出到 dist/
npm run e2e          # 自动化回归（无界面后台跑，不弹窗）
```

真实 API 冒烟（用你自己的简历 + 真实 LLM）：

```bash
RS_REAL_API_KEY=sk-xxx RS_REAL_BASE=https://api.deepseek.com RS_REAL_MODEL=deepseek-v4-flash \
RS_IMPORT_FILE=~/Downloads/简历.pdf RS_IMPORT_FILE2=~/Downloads/简历.docx \
node e2e/real-api-test.mjs
```

本地测试页（`e2e/fixtures` 下起 http server 后访问）：
- `bank-form.html` 银行全字段网申（多条目分区默认空、点添加出框）
- `moka-form.html` Moka 风格组件页（antd/Element 自定义下拉、级联省市、ant-picker 日期、Quill 富文本）

E2E 覆盖（54 项断言）：扫描分区 → 规则匹配 → 原生控件+自定义组件 → 自动点「添加」多条目 →
开放题不瞎填 → DOCX/PDF 导入 → LLM 抽取校对存档 → itSkills→自我评价兜底 → 手动编辑回归 →
LLM 兜底映射。全部无界面运行（Playwright Chromium + `--headless=new`；正式版 Chrome 137+ 已禁用
`--load-extension`，自动化一律用 Playwright 自带 Chromium）。调试想看界面：`HEADED=1 npm run e2e`。

安装到 Chrome：
1. 打开 `chrome://extensions`，右上角开启「开发者模式」；
2. 「加载已解压的扩展程序」→ 选择本项目的 `dist/` 目录。

开发模式（HMR）：`npm run dev`，同样加载 `dist/`（CRXJS 会热更新）。

## 本地测试（不碰真实投递站）

```bash
cd e2e/fixtures
python3 -m http.server 8000
# 打开 http://localhost:8000/bank-form.html
```

1. 插件设置页（右键插件图标 → 选项）→「简历档案」创建档案并填写；
2. 打开测试页 → 点击插件图标 → 「开始填写」；
3. 观察右下角面板：绿色=高置信已填，橙色=待确认，黄色=需手动（上传照）；
   「添加教育经历 / 添加家庭成员」按钮会被自动点击以创建多条目。

## 目录结构

```
src/
├── shared/      # 类型契约（Profile/FormSnapshot/FillPlan/消息协议）、存储、站点识别
├── background/  # SW：消息路由 + LLM 网关（含连通性测试）
├── content/     # 扫描器 scanner / 规则匹配 matcher+aliases / 执行器 executor / 侧栏面板 panel
├── popup/       # 弹窗：站点检测 → 选档案 → 开始填写 → 结果
└── options/     # 设置页：档案编辑器（basic/教育/意向/自我评价）、API 配置、隐私档位
e2e/fixtures/    # 本地 mock 表单（银行全字段、动态添加条目）
```

## 隐私

- 档案数据仅存本机 `chrome.storage.local`，无任何远端上传；
- API Key 仅 background 使用；身份证号、家庭成员姓名/电话任何模式下不发给 LLM；
- 默认隐私档 `with-values`（可在设置页降为 `labels-only` 或纯规则 `off`）。
