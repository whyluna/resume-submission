import type { Profile, Settings } from './types'
import { normalizeProfileDates } from './dateValues'

const KEY_PROFILES = 'rs.profiles'
const KEY_ACTIVE = 'rs.activeProfileId'
const KEY_SETTINGS = 'rs.settings'

/**
 * 档案数据修复：历史版本编辑器可能把 selfEvaluation 存成 {selfEvaluation:'...'}，
 * 读取/保存时统一拉平成字符串，避免填写时出现 "[object Object]"。
 */
export function normalizeProfile<T extends Profile>(p: T): T {
  const se = p.selfEvaluation as unknown
  if (se && typeof se === 'object') {
    p.selfEvaluation = String((se as Record<string, unknown>).selfEvaluation ?? '')
  } else if (typeof se !== 'string') {
    p.selfEvaluation = ''
  }
  if (!Array.isArray(p.itSkills)) p.itSkills = []
  return normalizeProfileDates(p)
}

export const DEFAULT_SETTINGS: Settings = {
  apiBaseUrl: '',
  apiKey: '',
  model: '',
  privacyMode: 'with-values', // 2026-08-22 决策 D
  autoPager: false, // 半自动翻页
}

function uid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export function createEmptyProfile(name = '我的档案'): Profile {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    id: uid(),
    name,
    updatedAt: now,
    basic: {
      name: '', lastName: '', firstName: '', englishName: '', gender: '', birthDate: '',
      nation: '汉族', politicalStatus: '共青团员', idType: '身份证', idNumber: '', phone: '',
      email: '', wechat: '', qq: '', nativePlace: '', hukou: '', hometown: '', currentCity: '',
      address: '', height: '', weight: '', maritalStatus: '未婚', health: '健康',
      emergencyContactName: '', emergencyContactRelation: '', emergencyContactPhone: '',
      hobbies: '', homepage: '',
    },
    intention: { cities: [], positions: [], salaryMin: '', salaryMax: '', availableDate: '', internDaysPerWeek: '', internMonths: '', acceptRelocation: '', notes: '' },
    educations: [emptyEducation()],
    experiences: [],
    projects: [],
    papers: [],
    competitions: [],
    awards: [],
    studentWork: [],
    languages: [],
    itSkills: [],
    certificates: [],
    familyMembers: [],
    selfEvaluation: '',
    openAnswers: [],
    extras: [],
  }
}

export function emptyEducation() {
  return {
    enabled: true, school: '', schoolCity: '', college: '', major: '', degree: '', education: '',
    startDate: '', endDate: '', endDateIsNow: false, studyMode: '全日制', eduType: '统招',
    schoolLevel: '', gpa: '', gpaTotal: '', rankPercent: '', ranking: '', isHighest: '', isOverseas: '否',
    courses: '', researchDirection: '', thesisTitle: '',
  }
}

export function emptyExperience(kind: 'internship' | 'fulltime' = 'internship') {
  return {
    enabled: true, kind, company: '', city: '', department: '', title: '', startDate: '',
    endDate: '', endDateIsNow: false, description: '', achievements: '', skills: [],
  }
}

export async function loadProfiles(): Promise<Profile[]> {
  const o = await chrome.storage.local.get(KEY_PROFILES)
  return ((o[KEY_PROFILES] as Profile[]) ?? []).map(normalizeProfile)
}

export async function saveProfiles(profiles: Profile[]): Promise<void> {
  await chrome.storage.local.set({ [KEY_PROFILES]: profiles.map(normalizeProfile) })
}

export async function getActiveProfileId(): Promise<string | null> {
  const o = await chrome.storage.local.get(KEY_ACTIVE)
  return o[KEY_ACTIVE] ?? null
}

export async function setActiveProfileId(id: string): Promise<void> {
  await chrome.storage.local.set({ [KEY_ACTIVE]: id })
}

export async function getActiveProfile(): Promise<Profile | null> {
  const [profiles, id] = await Promise.all([loadProfiles(), getActiveProfileId()])
  if (profiles.length === 0) return null
  return profiles.find((p) => p.id === id) ?? profiles[0]
}

export async function getSettings(): Promise<Settings> {
  const o = await chrome.storage.local.get(KEY_SETTINGS)
  return { ...DEFAULT_SETTINGS, ...(o[KEY_SETTINGS] ?? {}) }
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY_SETTINGS]: s })
}

/** 保证至少有一个档案；首次使用时创建默认档案 */
export async function ensureProfile(): Promise<Profile> {
  let profiles = await loadProfiles()
  if (profiles.length === 0) {
    const p = createEmptyProfile('我的档案')
    profiles = [p]
    await saveProfiles(profiles)
    await setActiveProfileId(p.id)
    return p
  }
  return profiles[0]
}

/** 导出/导入 */
export function exportProfiles(profiles: Profile[]): string {
  return JSON.stringify({ format: 'ResumeAutofillProfileBackup', version: 1, exportedAt: new Date().toISOString(), profiles }, null, 2)
}

export function parseBackup(text: string): Profile[] {
  const o = JSON.parse(text)
  if (o.format !== 'ResumeAutofillProfileBackup' || !Array.isArray(o.profiles)) {
    throw new Error('不是有效的档案备份文件')
  }
  return o.profiles.map(normalizeProfile)
}
