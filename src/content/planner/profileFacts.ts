import { SECTIONS } from '@/shared/profileSchema'
import type { PrivacyMode, Profile } from '@/shared/types'
import type { ProfileFactSummary } from '@/shared/semanticPlan'

const MASKED_PATHS = [
  /^basic\.(name|lastName|firstName|idNumber|phone|email|address|emergencyContactName|emergencyContactPhone)$/,
  /^familyMembers\[\d+\]\.(name|phone|age)$/,
]

function shouldMask(path: string): boolean {
  return MASKED_PATHS.some((pattern) => pattern.test(path))
}

function stringValue(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join('、')
  if (typeof value === 'boolean') return value ? '是' : '否'
  return value == null ? '' : String(value).trim()
}

function valueType(value: unknown, key: string, declared?: ProfileFactSummary['valueType']): ProfileFactSummary['valueType'] {
  if (declared) return declared
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'boolean') return 'boolean'
  if (/date|time/i.test(key)) return 'date'
  if (/score|gpa|height|weight|age|salary|rank/i.test(key)) return 'number'
  return 'text'
}

export function buildProfileFactSummaries(profile: Profile, privacyMode: PrivacyMode): ProfileFactSummary[] {
  const facts: ProfileFactSummary[] = []
  const store = profile as unknown as Record<string, unknown>
  const push = (path: string, label: string, key: string, value: unknown, declared?: ProfileFactSummary['valueType']) => {
    const text = stringValue(value)
    if (!text) return
    const masked = shouldMask(path)
    facts.push({
      path,
      label,
      valueType: valueType(value, key, declared),
      value: privacyMode === 'with-values' && !masked ? text : undefined,
      masked,
    })
  }

  for (const section of SECTIONS) {
    if (section.repeat) {
      const rows = store[section.key]
      if (!Array.isArray(rows)) continue
      rows.forEach((row, index) => {
        const item = row as Record<string, unknown>
        if (item.enabled === false) return
        for (const field of section.fields) push(`${section.key}[${index}].${field.k}`, field.label, field.k, item[field.k], field.ctrl === 'select' ? 'enum' : undefined)
        if (item.endDateIsNow === true) push(`${section.key}[${index}].endDateIsNow`, '至今 / 进行中', 'endDateIsNow', true)
        if ('startDate' in item || 'endDate' in item || 'endDateIsNow' in item) {
          const start = stringValue(item.startDate)
          const end = item.endDateIsNow === true ? '至今' : stringValue(item.endDate)
          push(`${section.key}[${index}].__range`, '起止时间', '__range', [start, end].filter(Boolean).join(' ~ '))
        }
      })
      continue
    }
    if (section.key === 'selfEvaluation') {
      push('selfEvaluation.selfEvaluation', '自我评价', 'selfEvaluation', profile.selfEvaluation)
      continue
    }
    const object = store[section.key]
    if (!object || typeof object !== 'object') continue
    for (const field of section.fields) {
      push(`${section.key}.${field.k}`, field.label, field.k, (object as Record<string, unknown>)[field.k], field.ctrl === 'select' ? 'enum' : undefined)
    }
  }

  profile.itSkills?.forEach((skill, index) => push(`itSkills[${index}].skill`, '专业技能', 'skill', skill.skill))
  profile.extras?.forEach((extra, index) => {
    const path = `extras[${index}].value`
    const text = stringValue(extra.value)
    if (!text) return
    const masked = extra.sensitive === true
    facts.push({ path, label: extra.label, valueType: 'text', value: privacyMode === 'with-values' && !masked ? text : undefined, masked })
  })
  return facts
}
