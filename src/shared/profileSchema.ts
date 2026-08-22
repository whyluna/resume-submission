/**
 * Profile 元数据：全分区字段定义（键、中文标签、控件、选项）。
 * 三处共用：options 编辑器（SectionEditor）、LLM 抽取 prompt、LLM 兜底匹配的简历侧摘要。
 * 改字段时同步 src/shared/types.ts 的 Profile 结构。
 */

export interface FieldDef {
  k: string
  label: string
  ctrl?: 'text' | 'textarea' | 'select'
  options?: string[]
  ph?: string
  /** 值是 string[]，编辑器按顿号拆合（如主修课程之外的城市/职位/技术栈） */
  list?: boolean
  /** 敏感：编辑器加提示；发给 LLM 的摘要中以 *** 掩码 */
  sensitive?: boolean
}

export interface SectionDef {
  key:
    | 'basic' | 'intention' | 'selfEvaluation'
    | 'educations' | 'experiences' | 'projects' | 'papers' | 'competitions'
    | 'awards' | 'studentWork' | 'languages' | 'certificates' | 'familyMembers'
  title: string
  repeat: boolean
  itemTitle: string
  fields: FieldDef[]
}

export const SECTIONS: SectionDef[] = [
  {
    key: 'basic',
    title: '基本信息',
    repeat: false,
    itemTitle: '基本信息',
    fields: [
      { k: 'name', label: '姓名' },
      { k: 'gender', label: '性别', ctrl: 'select', options: ['', '男', '女'] },
      { k: 'birthDate', label: '出生日期', ph: '2001-03-15' },
      { k: 'nation', label: '民族', ph: '汉族' },
      { k: 'politicalStatus', label: '政治面貌', ctrl: 'select', options: ['', '中共党员', '中共预备党员', '共青团员', '群众', '民主党派'] },
      { k: 'idType', label: '证件类型', ctrl: 'select', options: ['身份证', '护照'] },
      { k: 'idNumber', label: '证件号码', sensitive: true },
      { k: 'phone', label: '手机' },
      { k: 'email', label: '邮箱' },
      { k: 'wechat', label: '微信号' },
      { k: 'qq', label: 'QQ' },
      { k: 'nativePlace', label: '籍贯', ph: '广东省 广州市' },
      { k: 'hukou', label: '户口所在地' },
      { k: 'hometown', label: '生源地' },
      { k: 'currentCity', label: '现居住城市' },
      { k: 'address', label: '详细地址' },
      { k: 'maritalStatus', label: '婚姻状况', ctrl: 'select', options: ['', '未婚', '已婚', '离异'] },
      { k: 'height', label: '身高(cm)' },
      { k: 'weight', label: '体重(kg)' },
      { k: 'health', label: '健康状况', ph: '健康' },
      { k: 'emergencyContactName', label: '紧急联系人' },
      { k: 'emergencyContactRelation', label: '紧急联系人关系' },
      { k: 'emergencyContactPhone', label: '紧急联系人电话' },
      { k: 'hobbies', label: '兴趣爱好' },
      { k: 'homepage', label: '个人主页/GitHub' },
      { k: 'englishName', label: '英文名' },
    ],
  },
  {
    key: 'intention',
    title: '求职意向',
    repeat: false,
    itemTitle: '求职意向',
    fields: [
      { k: 'cities', label: '期望城市', list: true, ph: '杭州市、深圳市' },
      { k: 'positions', label: '期望职位', list: true, ph: '后端开发工程师' },
      { k: 'salaryMin', label: '期望薪资下限(万)' },
      { k: 'salaryMax', label: '期望薪资上限(万)' },
      { k: 'availableDate', label: '到岗时间', ph: '随时 / 2026-07' },
      { k: 'internDaysPerWeek', label: '每周实习天数' },
      { k: 'internMonths', label: '可实习月数' },
      { k: 'acceptRelocation', label: '是否接受调剂/出差', ctrl: 'select', options: ['', '是', '否'] },
    ],
  },
  {
    key: 'educations',
    title: '教育经历',
    repeat: true,
    itemTitle: '教育经历',
    fields: [
      { k: 'school', label: '学校' },
      { k: 'college', label: '学院' },
      { k: 'major', label: '专业' },
      { k: 'education', label: '学历', ctrl: 'select', options: ['', '博士研究生', '硕士研究生', '本科', '专科', '其他'] },
      { k: 'degree', label: '学位', ctrl: 'select', options: ['', '博士', '硕士', '学士', '双学位', '无'] },
      { k: 'startDate', label: '开始时间', ph: '2022-09' },
      { k: 'endDate', label: '结束时间', ph: '2026-06' },
      { k: 'studyMode', label: '学习形式', ctrl: 'select', options: ['', '全日制', '非全日制'] },
      { k: 'eduType', label: '培养方式', ph: '统招' },
      { k: 'schoolLevel', label: '学校类别', ph: '985 / 211 / 双一流 / QS前100' },
      { k: 'gpa', label: 'GPA/绩点' },
      { k: 'gpaTotal', label: 'GPA满分' },
      { k: 'rankPercent', label: '专业排名', ph: '前10%' },
      { k: 'ranking', label: '具体排名', ph: '5/120' },
      { k: 'courses', label: '主修课程' },
      { k: 'researchDirection', label: '研究方向' },
      { k: 'thesisTitle', label: '毕业论文题目' },
      { k: 'isOverseas', label: '是否海外学历', ctrl: 'select', options: ['', '是', '否'] },
    ],
  },
  {
    key: 'experiences',
    title: '实习/工作经历',
    repeat: true,
    itemTitle: '经历',
    fields: [
      { k: 'kind', label: '类型', ctrl: 'select', options: ['internship', 'fulltime'] },
      { k: 'company', label: '公司名称' },
      { k: 'department', label: '部门' },
      { k: 'title', label: '职位' },
      { k: 'city', label: '城市' },
      { k: 'startDate', label: '开始时间', ph: '2024-06' },
      { k: 'endDate', label: '结束时间', ph: '2024-12（至今则填"至今"）' },
      { k: 'description', label: '工作内容', ctrl: 'textarea' },
      { k: 'achievements', label: '主要业绩', ctrl: 'textarea' },
    ],
  },
  {
    key: 'projects',
    title: '项目经历',
    repeat: true,
    itemTitle: '项目',
    fields: [
      { k: 'name', label: '项目名称' },
      { k: 'role', label: '担任角色' },
      { k: 'startDate', label: '开始时间' },
      { k: 'endDate', label: '结束时间' },
      { k: 'url', label: '项目链接' },
      { k: 'techStack', label: '技术栈', list: true, ph: 'Go、Kafka、Redis' },
      { k: 'description', label: '项目描述', ctrl: 'textarea' },
      { k: 'contribution', label: '个人贡献', ctrl: 'textarea' },
    ],
  },
  {
    key: 'papers',
    title: '论文/科研',
    repeat: true,
    itemTitle: '论文',
    fields: [
      { k: 'title', label: '题目' },
      { k: 'venue', label: '期刊/会议' },
      { k: 'publishDate', label: '发表时间' },
      { k: 'authorOrder', label: '作者排序', ph: '第一作者' },
      { k: 'indexed', label: '检索', ph: 'SCI / EI / CCF-A' },
      { k: 'link', label: '链接' },
      { k: 'description', label: '论文介绍', ctrl: 'textarea', ph: '论文摘要/贡献/个人工作，网申常要求填写' },
    ],
  },
  {
    key: 'competitions',
    title: '竞赛经历',
    repeat: true,
    itemTitle: '竞赛',
    fields: [
      { k: 'name', label: '竞赛名称' },
      { k: 'level', label: '级别', ctrl: 'select', options: ['', '国际', '国家级', '省级', '市级', '校级'] },
      { k: 'award', label: '奖项等级', ph: '一等奖 / 金奖' },
      { k: 'date', label: '获奖时间' },
      { k: 'role', label: '担任角色' },
      { k: 'description', label: '说明', ctrl: 'textarea' },
    ],
  },
  {
    key: 'awards',
    title: '荣誉奖项',
    repeat: true,
    itemTitle: '荣誉',
    fields: [
      { k: 'name', label: '奖项名称' },
      { k: 'level', label: '级别', ctrl: 'select', options: ['', '国际', '国家级', '省级', '市级', '校级'] },
      { k: 'date', label: '获奖时间' },
    ],
  },
  {
    key: 'studentWork',
    title: '学生工作/社会实践',
    repeat: true,
    itemTitle: '经历',
    fields: [
      { k: 'org', label: '组织名称' },
      { k: 'role', label: '职务' },
      { k: 'startDate', label: '开始时间' },
      { k: 'endDate', label: '结束时间' },
      { k: 'description', label: '工作内容', ctrl: 'textarea' },
    ],
  },
  {
    key: 'languages',
    title: '语言能力',
    repeat: true,
    itemTitle: '语言',
    fields: [
      { k: 'language', label: '语言', ph: '英语' },
      { k: 'certificate', label: '证书', ph: 'CET-4 / CET-6 / 托福 / 雅思' },
      { k: 'score', label: '分数' },
      { k: 'date', label: '考试时间' },
      { k: 'proficiency', label: '熟练程度' },
    ],
  },
  {
    key: 'certificates',
    title: '证书',
    repeat: true,
    itemTitle: '证书',
    fields: [
      { k: 'name', label: '证书名称' },
      { k: 'issuer', label: '颁发机构' },
      { k: 'date', label: '获得时间' },
      { k: 'number', label: '证书编号' },
    ],
  },
  {
    key: 'familyMembers',
    title: '家庭成员',
    repeat: true,
    itemTitle: '成员',
    fields: [
      { k: 'relation', label: '与本人关系', ph: '父亲 / 母亲' },
      { k: 'name', label: '姓名', sensitive: true },
      { k: 'age', label: '年龄' },
      { k: 'company', label: '工作单位' },
      { k: 'position', label: '职务' },
      { k: 'politicalStatus', label: '政治面貌' },
      { k: 'phone', label: '联系电话', sensitive: true },
    ],
  },
  {
    key: 'selfEvaluation',
    title: '自我评价',
    repeat: false,
    itemTitle: '自我评价',
    fields: [{ k: 'selfEvaluation', label: '自我评价', ctrl: 'textarea', ph: '200~500 字，部分站点会按 maxLength 截断' }],
  },
]

export const SECTION_BY_KEY: Record<string, SectionDef> = Object.fromEntries(SECTIONS.map((s) => [s.key, s]))

/** repeat 分区在 Profile 上对应的数组字段名 */
export const SECTION_ITEM_ARRAY: Partial<Record<string, string>> = {
  educations: 'educations',
  experiences: 'experiences',
  projects: 'projects',
  papers: 'papers',
  competitions: 'competitions',
  awards: 'awards',
  studentWork: 'studentWork',
  languages: 'languages',
  certificates: 'certificates',
  familyMembers: 'familyMembers',
}

/** 生成某分区的一条空条目（编辑器「＋添加」用） */
export function emptyItemFor(sectionKey: string): Record<string, unknown> {
  const def = SECTION_BY_KEY[sectionKey]
  if (!def) return { enabled: true }
  const item: Record<string, unknown> = def.repeat ? { enabled: true } : {}
  for (const f of def.fields) item[f.k] = f.list ? [] : f.ctrl === 'select' ? (f.options?.[0] ?? '') : ''
  const defaults: Record<string, Record<string, unknown>> = {
    educations: { studyMode: '全日制', eduType: '统招', isOverseas: '否' },
    experiences: { kind: 'internship' },
    familyMembers: { relation: '父亲' },
    languages: { language: '英语' },
  }
  return { ...item, ...(defaults[sectionKey] ?? {}) }
}
