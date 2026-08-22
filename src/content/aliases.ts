import type { SectionKey } from '@/shared/types'
import { norm } from '@/shared/util'

/**
 * 规则层字段别名词典（种子版，M1 扩充到 300+）。
 * 结构：分区 → 档案字段 → 页面常见问法。全部走 norm() 归一化后匹配。
 */
export const ALIASES: Partial<Record<SectionKey, Record<string, string[]>>> = {
  basic: {
    name: ['姓名', '名字', '您的姓名', 'applicantname', 'fullname', 'name'],
    gender: ['性别'],
    birthDate: ['出生日期', '出生年月', '生日', '出生年月日'],
    nation: ['民族'],
    politicalStatus: ['政治面貌', '政治面目'],
    idNumber: ['身份证号', '身份证号码', '证件号码', '身份证', 'idnumber'],
    phone: ['手机', '手机号', '手机号码', '联系电话', '联系手机', '电话号码', '电话', '联系方式', 'mobile', 'phone', 'tel'],
    email: ['邮箱', '电子邮箱', '电子邮件', '邮件地址', 'email', 'mail', 'e-mail'],
    wechat: ['微信号', '微信'],
    qq: ['qq', 'qq号'],
    nativePlace: ['籍贯', '祖籍'],
    hukou: ['户口所在地', '户口', '户籍', '户籍所在地', '户籍地'],
    hometown: ['生源地', '生源地区'],
    currentCity: ['现居住城市', '现居城市', '现居住地', '当前居住城市', '现所在地', '居住城市', '所在城市'],
    address: ['现居住地址', '详细地址', '居住地址', '通讯地址', '联系地址', '地址'],
    height: ['身高'],
    weight: ['体重'],
    maritalStatus: ['婚姻状况', '婚姻'],
    health: ['健康状况', '健康情况'],
    emergencyContactName: ['紧急联系人'],
    emergencyContactRelation: ['与紧急联系人关系', '紧急联系人关系', '联系人关系'],
    emergencyContactPhone: ['紧急联系人电话', '紧急人电话', '紧急联系电话'],
    hobbies: ['兴趣爱好', '爱好'],
    homepage: ['个人主页', '博客', 'github', '个人网站', '主页'],
    englishName: ['英文名', '英文名称'],
    lastName: ['姓'],
    firstName: ['名'],
  },
  intention: {
    cities: ['期望城市', '期望工作城市', '意向城市', '意向工作地', '期望工作地', '期望地点', '工作城市'],
    positions: ['期望职位', '期望岗位', '意向岗位', '应聘岗位', '求职意向', '意向职位'],
    salaryMin: ['期望薪资', '期望月薪', '期望年薪', '薪资要求', '期望薪水'],
    availableDate: ['到岗时间', '可到岗时间', '入职时间', '可入职时间', '最快到岗'],
    internDaysPerWeek: ['每周实习天数', '每周可实习', '实习天数', '每周工作天数'],
    internMonths: ['可实习时长', '实习时长', '可实习月数'],
    acceptRelocation: ['是否接受调剂', '是否接受出差', '是否接受外派', '接受调剂'],
  },
  educations: {
    school: ['学校', '院校', '学校名称', '毕业院校', '就读院校', '就读学校', '院校名称', 'university', 'schoolname'],
    schoolCity: ['学校所在地', '学校城市'],
    college: ['学院', '院系', '学院名称', '所在学院'],
    major: ['专业', '专业名称', '就读专业', '所学专业'],
    degree: ['学位', '学位类型'],
    education: ['学历', '学历层次', '最高学历'],
    __range: ['就读时间', '教育时间', '教育经历时间'],
    startDate: ['入学时间', '开始时间', '入学年月', '教育开始时间', '起始时间', '入读时间'],
    endDate: ['毕业时间', '结束时间', '毕业年月', '教育结束时间', '截止时间', '离校时间'],
    studyMode: ['学习形式', '学习方式', '就读方式'],
    eduType: ['教育类型', '培养方式', '录取批次', '办学类型'],
    schoolLevel: ['学校类别', '院校类别', '学校类型'],
    gpa: ['gpa', '绩点', '平均绩点'],
    gpaTotal: ['gpa满分', '总绩点'],
    rankPercent: ['专业排名', '成绩排名', '排名百分比', '年级排名'],
    ranking: ['具体排名', '综合排名'],
    courses: ['主修课程', '主要课程', '课程', '专业课程'],
    researchDirection: ['研究方向'],
    thesisTitle: ['毕业论文', '论文题目', '毕业设计'],
    isHighest: ['是否最高学历', '最高学历标记'],
    isOverseas: ['是否海外学历', '海外学历'],
  },
  experiences: {
    company: ['公司名称', '公司', '单位名称', '工作单位', '实习单位', '实习公司', 'companyname'],
    city: ['所在城市', '工作城市', '实习城市', '城市'],
    department: ['部门', '所在部门', '部门名称'],
    title: ['职位', '职务', '岗位', '职位名称', '实习岗位', '实习职位', '职称'],
    __range: ['起止时间', '工作时间', '实习时间'],
    startDate: ['开始时间', '入职时间', '起始时间', '实习开始时间', '工作开始时间'],
    endDate: ['结束时间', '离职时间', '截止时间', '实习结束时间', '工作结束时间'],
    description: ['工作内容', '工作描述', '工作职责', '实习内容', '实习描述', '职责描述', '工作经历描述', '内容描述'],
    achievements: ['工作业绩', '主要业绩', '业绩成果', '工作成果', '实习成果'],
  },
  papers: {
    title: ['论文题目', '论文标题', '题目', '论文名称', '论文名', '论文', 'paper'],
    venue: ['期刊', '会议', '期刊名称', '发表期刊', '会议名称', '期刊会议', '发表刊物', '刊物'],
    publishDate: ['发表时间', '发表日期', '出版时间', '刊登时间', '见刊时间'],
    authorOrder: ['作者排序', '第几作者', '作者顺序', '作者身份'],
    indexed: ['检索', '收录', '检索情况', '收录情况'],
    link: ['论文链接', '链接'],
    description: ['论文介绍', '论文描述', '论文简介', '论文摘要', '摘要', '内容简介', '个人工作'],
  },
  projects: {
    name: ['项目名称', '项目名', 'projectname'],
    role: ['担任角色', '项目角色', '角色', '担任职务', '职责', '项目职务'],
    __range: ['起止时间', '项目时间'],
    startDate: ['开始时间', '项目开始时间', '起始时间'],
    endDate: ['结束时间', '项目结束时间', '截止时间'],
    url: ['项目链接', '项目地址', '链接', 'github地址'],
    description: ['项目描述', '项目简介', '项目介绍', '项目内容'],
    contribution: ['个人职责', '个人贡献', '负责内容', '我的职责', '项目中职责'],
    achievements: ['项目成果', '成果', '业绩'],
    techStack: ['技术栈', '使用技术', '涉及技术', '项目技能'],
  },
  competitions: {
    name: ['竞赛名称', '比赛名称', '奖项名称', '获奖名称', '竞赛'],
    level: ['获奖级别', '竞赛级别', '级别', '奖项级别'],
    award: ['奖项等级', '获奖等级', '所获奖项', '奖项', '等级'],
    date: ['获奖时间', '时间', '竞赛时间'],
    teamSize: ['团队规模', '团队人数'],
    role: ['担任角色', '角色'],
    description: ['获奖说明', '竞赛描述', '描述'],
  },
  awards: {
    name: ['奖项名称', '荣誉名称', '奖励名称', '获奖名称', '奖项'],
    level: ['获奖级别', '荣誉级别', '级别'],
    date: ['获奖时间', '获得时间', '时间'],
  },
  studentWork: {
    org: ['组织名称', '社团名称', '单位名称', '组织', '社团', '机构名称'],
    role: ['职务', '担任职务', '角色', '职位'],
    __range: ['起止时间'],
    startDate: ['开始时间', '起始时间'],
    endDate: ['结束时间', '截止时间'],
    description: ['工作内容', '工作描述', '职责描述', '描述'],
  },
  languages: {
    language: ['语种', '语言', '语言种类'],
    certificate: ['语言证书', '证书名称', '英语等级', '等级证书', '证书'],
    score: ['分数', '成绩', '考试分数', '分数成绩'],
    proficiency: ['熟练程度', '掌握程度', '水平'],
    date: ['获得时间', '考试时间', '时间'],
  },
  itSkills: {
    skill: ['技能名称', '技能', '特长'],
    level: ['熟练程度', '掌握程度'],
  },
  certificates: {
    name: ['证书名称', '资格证书', '证书'],
    issuer: ['颁发机构', '发证机构', '颁发单位'],
    date: ['获得时间', '取得时间', '发证时间', '时间'],
    number: ['证书编号', '编号'],
  },
  familyMembers: {
    relation: ['与本人关系', '关系', '称谓', '家庭成员关系'],
    name: ['姓名', '成员姓名'],
    age: ['年龄', '出生年月'],
    company: ['工作单位', '单位', '工作单位及部门'],
    position: ['职务', '职位', '工作岗位'],
    politicalStatus: ['政治面貌', '政治面目'],
    phone: ['联系电话', '电话', '联系方式'],
  },
  selfEvaluation: {
    selfEvaluation: ['自我评价', '个人评价', '个人优势', '自我介绍', '个人简介', '自我描述'],
  },
}

// SECTION_ITEM_ARRAY 已移至 @/shared/profileSchema（编辑器/抽取 prompt 共用）

/** 预归一化词典：norm(alias) → Set */
const NORMALIZED: Partial<Record<SectionKey, Record<string, string[]>>> = Object.fromEntries(
  Object.entries(ALIASES).map(([k, fields]) => [
    k,
    Object.fromEntries(Object.entries(fields).map(([f, list]) => [f, list.map(norm).filter(Boolean)])),
  ]),
) as Partial<Record<SectionKey, Record<string, string[]>>>

export function normalizedAliases(section: SectionKey): Record<string, string[]> {
  return NORMALIZED[section] ?? {}
}
