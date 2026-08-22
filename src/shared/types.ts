/**
 * 全扩展数据契约。options（编辑档案）/ background（路由+LLM）/ content（扫描+填写）
 * 三方只通过这里的类型交互，改动需三端同步。
 */

import type { PageModel } from './pageModel'
import type { SemanticPlanItem } from './semanticPlan'
import type { AgentToolCall, AgentToolResult, AgentTrace } from './agent'
import type { FormPageIR } from './formIr'

// ---------------- Profile：简历档案 ----------------

export interface Basic {
  name: string
  lastName: string
  firstName: string
  englishName: string
  gender: string // 男 / 女
  birthDate: string // YYYY-MM-DD 或 YYYY-MM
  nation: string // 民族
  politicalStatus: string // 政治面貌
  idType: string // 身份证 / 护照
  idNumber: string
  phone: string
  email: string
  wechat: string
  qq: string
  nativePlace: string // 籍贯
  hukou: string // 户口所在地
  hometown: string // 生源地
  currentCity: string
  address: string
  height: string
  weight: string
  maritalStatus: string
  health: string
  emergencyContactName: string
  emergencyContactRelation: string
  emergencyContactPhone: string
  hobbies: string
  homepage: string
}

export interface Intention {
  cities: string[]
  positions: string[]
  salaryMin: string
  salaryMax: string
  availableDate: string
  internDaysPerWeek: string
  internMonths: string
  acceptRelocation: string // 是 / 否 / 空
  notes: string
}

export interface Education {
  enabled: boolean
  school: string
  schoolCity: string
  college: string
  major: string
  degree: string // 学位：学士/硕士/博士/…
  education: string // 学历：本科/硕士研究生/博士研究生/…
  startDate: string // YYYY-MM
  endDate: string
  endDateIsNow: boolean // 至今
  studyMode: string // 全日制 / 非全日制
  eduType: string // 统招 / 自考 / …
  schoolLevel: string // 985/211/双一流/QS排名…
  gpa: string
  gpaTotal: string
  rankPercent: string // 前10%
  ranking: string // 5/120
  isHighest: string
  isOverseas: string
  courses: string
  researchDirection: string
  thesisTitle: string
}

export interface Experience {
  enabled: boolean
  kind: 'internship' | 'fulltime'
  company: string
  city: string
  department: string
  title: string
  startDate: string
  endDate: string
  endDateIsNow: boolean
  description: string
  achievements: string
  skills: string[]
}

export interface Project {
  enabled: boolean
  name: string
  role: string
  startDate: string
  endDate: string
  endDateIsNow: boolean
  url: string
  description: string
  contribution: string
  achievements: string
  techStack: string[]
}

export interface Paper {
  enabled: boolean
  title: string
  venue: string
  publishDate: string
  authorOrder: string
  link: string
  indexed: string // SCI/EI/…
  description: string // 论文介绍/摘要/个人工作
}

export interface Competition {
  enabled: boolean
  name: string
  level: string // 国家级/省级/校级/国际
  award: string // 一等奖/金奖/…
  date: string
  teamSize: string
  role: string
  description: string
}

export interface Award {
  enabled: boolean
  name: string
  level: string
  date: string
}

export interface OrgExperience {
  enabled: boolean
  org: string
  role: string
  startDate: string
  endDate: string
  endDateIsNow: boolean
  description: string
}

export interface LanguageSkill {
  enabled: boolean
  language: string
  certificate: string // CET-4/CET-6/托福/雅思
  score: string
  date: string
  proficiency: string
}

export interface ItSkill {
  skill: string
  level: 1 | 2 | 3 | 4
}

export interface Certificate {
  enabled: boolean
  name: string
  issuer: string
  date: string
  number: string
}

export interface FamilyMember {
  enabled: boolean
  relation: string
  name: string
  age: string
  company: string
  position: string
  politicalStatus: string
  phone: string
}

export interface OpenAnswer {
  tags: string[] // 如 ['为什么选择我们']
  question: string
  answer: string
}

export interface ExtraKV {
  label: string
  value: string
  sensitive?: boolean
}

export interface ProfileRaw {
  fullText: string
  sourceFileName: string
}

export interface Profile {
  schemaVersion: 1
  id: string
  name: string // 档案名：技术岗版 / 银行版…
  updatedAt: string
  basic: Basic
  intention: Intention
  educations: Education[]
  experiences: Experience[]
  projects: Project[]
  papers: Paper[]
  competitions: Competition[]
  awards: Award[]
  studentWork: OrgExperience[]
  languages: LanguageSkill[]
  itSkills: ItSkill[]
  certificates: Certificate[]
  familyMembers: FamilyMember[]
  selfEvaluation: string
  openAnswers: OpenAnswer[]
  extras: ExtraKV[]
  raw?: ProfileRaw
}

// 任何 LLM 请求都不得携带其值（隐私底线，用户选择 with-values 也一样）
export const SENSITIVE_PATHS: readonly string[] = [
  'basic.idNumber',
  'familyMembers[*].phone',
  'familyMembers[*].name',
]

// ---------------- Settings ----------------

export type PrivacyMode = 'off' | 'labels-only' | 'with-values'

export interface Settings {
  apiBaseUrl: string // OpenAI 兼容，如 https://api.deepseek.com/v1
  apiKey: string
  model: string
  privacyMode: PrivacyMode // 默认 with-values（2026-08-22 决策）
  agentMode: boolean // LLM 主导的受控工具循环；关闭时使用 V2/旧规则降级
  autoPager: boolean // 多页表单自动翻页；false=半自动（默认）
}

// ---------------- FormSnapshot：表单快照 ----------------

export type ControlKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'customselect' // antd/Element/Arco/Moka 等自定义下拉（点开浮层选）
  | 'radio'
  | 'checkbox'
  | 'date' // 原生 date/month 或自定义日期组件（ant-picker 等）
  | 'cascader' // 级联选择（省市区逐级点）
  | 'richtext'
  | 'upload'
  | 'unknown'

/** 稳定 DOM 引用：CSS 路径 + 同路径序号，DOM 重建后可重定位 */
export interface StableRef {
  cssPath: string
  index: number
}

export interface FieldSignals {
  label: string // 最佳标签（label 绑定 / 左侧文本 / aria）
  labelNear: string[] // 周边其他线索文本
  name: string
  id: string
  placeholder: string
  ariaLabel: string
  title: string
  sectionText: string // 所在分区标题链，如 "教育经历"
  options?: string[] // select/radio/checkbox 的全部选项文本
  required: boolean
  maxLength?: number
}

export interface FieldEl {
  ref: StableRef
  control: ControlKind
  el: Element // 仅 content 内部使用，序列化时剔除
  signals: FieldSignals
  signature: string // 归一化信号哈希，记忆层 key
}

export interface BtnCandidate {
  ref: StableRef
  el: Element
  text: string
  kind: 'add' | 'next' | 'submit'
}

export type SectionKey =
  | 'basic'
  | 'intention'
  | 'educations'
  | 'experiences'
  | 'projects'
  | 'papers'
  | 'competitions'
  | 'awards'
  | 'studentWork'
  | 'languages'
  | 'itSkills'
  | 'certificates'
  | 'familyMembers'
  | 'selfEvaluation'
  | 'openQuestions'
  | 'unknown'

export interface GroupEl {
  sectionKey: SectionKey
  sectionHint: string // 页面上的分区标题原文
  kind: 'simple' | 'repeat'
  fields: FieldEl[]
  buttons: BtnCandidate[]
}

export interface FormSnapshot {
  url: string
  title: string
  scannedAt: number
  framePath: number[] // frame 层级链，v0 恒为 []
  groups: GroupEl[]
}

// ---------------- FillPlan：填写计划与结果 ----------------

export type FillVia = 'memory' | 'rule' | 'llm'

export interface PlanItem {
  fieldRef: StableRef
  sectionKey: SectionKey
  profilePath: string // 如 basic.name / educations[1].school
  label: string
  value: string
  confidence: number // 0~1
  via: FillVia
  reason: string
}

export type ItemStatus = 'filled' | 'review' | 'failed' | 'skipped'

export interface FillResultItem extends PlanItem {
  status: ItemStatus
  error?: string
}

export interface FillSummary {
  totalFields: number
  filled: number
  review: number
  failed: number
  unmatched: number
  manual: number // 需手动：上传/验证码等
  items: FillResultItem[]
  siteName: string
  at: number
}

// ---------------- LLM ----------------

export interface LlmExtractRes {
  ok: boolean
  draft?: Partial<Profile>
  message: string
}

export interface LlmMatchFieldIn {
  i: number
  label: string
  name: string
  id: string
  placeholder: string
  section: string // 页面分区标题 + 槽位提示，如 "教育经历 第2条"
  options?: string[]
  /** 规则引擎第一轮的映射结果（null=未匹配），供 LLM 复审纠错 */
  rule?: { path: string; score: number; value?: string } | null
}

export interface LlmMatchItem {
  i: number
  path: string // 如 basic.name / educations[1].school
  c: number // 置信度 0~1
  why: string
  op?: 'fill' | 'fix' // fill=补填未映射字段（默认）；fix=纠正规则层的错误映射
}

export interface LlmMatchRes {
  ok: boolean
  plan?: LlmMatchItem[]
  message: string
}

// ---------------- 消息协议 ----------------

export type ExtMessage =
  | { type: 'GET_STATE' } // popup → bg：当前页站点识别
  | { type: 'LLM_TEST' } // options → bg：连通性测试
  | { type: 'LLM_EXTRACT'; text: string } // options → bg：简历文本 → 结构化档案
  | { type: 'LLM_MATCH'; fields: LlmMatchFieldIn[]; profileLines: string[] } // content → bg：字段映射兜底
  | { type: 'LLM_PLAN_PAGE'; model: PageModel } // content → bg：V2 全分区语义规划
  | { type: 'LLM_AGENT_ROUND'; model: PageModel; round: number; targetFieldIds: string[]; previousResults: AgentToolResult[]; previousIssues: string[] }
  | { type: 'LLM_PLAN_ONESHOT'; ir: FormPageIR }
  | { type: 'CONTENT_SCAN' } // popup → content：仅扫描
  | { type: 'CONTENT_FILL' } // popup → content：扫描+匹配+填写
  | { type: 'CONTENT_FILL_V2' } // 调试/灰度：V2 PageModel → planner → verified executor
  | { type: 'CONTENT_PANEL_TOGGLE'; visible: boolean }

export interface GetStateRes {
  url: string | null
  siteName: string
  siteAdapter: string
  canInject: boolean
}

export interface ScanRes {
  ok: boolean
  groups: Array<{ sectionKey: SectionKey; sectionHint: string; fieldCount: number; hasAddButton: boolean }>
  v2?: {
    adapterId: string
    maturity: string
    totalFields: number
    forbiddenActions: number
    sections: Array<{ title: string; entryCount: number; fieldCount: number }>
  }
}

export interface LlmTestRes {
  ok: boolean
  message: string
  latencyMs?: number
}

export interface SemanticPlannerResponse {
  ok: boolean
  plan: SemanticPlanItem[]
  rejected: number
  messages: string[]
  error?: string
}

export interface AgentRoundResponse {
  ok: boolean
  calls: AgentToolCall[]
  coveredFieldIds: string[]
  missingFieldIds: string[]
  rejected: string[]
  trace?: AgentTrace
  observationFieldCount: number
  error?: string
}

export interface OneShotPlannerResponse {
  ok: boolean
  mode: 'llm' | 'rule-fallback'
  calls: AgentToolCall[]
  modelRequestCount: 0 | 1
  complete: boolean
  rejected: string[]
  messages: string[]
  latencyMs: number
  error?: string
}
