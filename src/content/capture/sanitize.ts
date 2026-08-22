import type { PageModel, SemanticSignalsV2 } from '@/shared/pageModel'

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE_RE = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g
const ID_RE = /(?<!\d)\d{17}[\dXx](?!\d)/g
const LONG_TOKEN_RE = /[A-Za-z0-9_-]{24,}/g

export function redactCaptureText(value: string): string {
  return value
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(PHONE_RE, '[redacted-phone]')
    .replace(ID_RE, '[redacted-id]')
}

export function sanitizeCaptureUrl(raw: string): string {
  try {
    const url = new URL(raw)
    for (const key of Array.from(url.searchParams.keys())) url.searchParams.set(key, ':redacted')
    url.hash = url.hash.replace(LONG_TOKEN_RE, ':token')
    url.pathname = url.pathname.replace(LONG_TOKEN_RE, ':token')
    return url.toString()
  } catch {
    return raw.replace(LONG_TOKEN_RE, ':token')
  }
}

function sanitizeSignals(signals: SemanticSignalsV2): SemanticSignalsV2 {
  return {
    ...signals,
    label: redactCaptureText(signals.label),
    labelNear: signals.labelNear.map(redactCaptureText),
    placeholder: redactCaptureText(signals.placeholder),
    name: redactCaptureText(signals.name),
    id: redactCaptureText(signals.id),
    ariaLabel: redactCaptureText(signals.ariaLabel),
    title: redactCaptureText(signals.title),
    sectionTitle: redactCaptureText(signals.sectionTitle),
  }
}

export function sanitizePageModel(model: PageModel): PageModel {
  return {
    ...model,
    url: sanitizeCaptureUrl(model.url),
    sections: model.sections.map((section) => ({
      ...section,
      title: redactCaptureText(section.title),
      entries: section.entries.map((entry) => ({
        ...entry,
        fields: entry.fields.map((field) => ({ ...field, signals: sanitizeSignals(field.signals) })),
      })),
      fields: section.fields.map((field) => ({ ...field, signals: sanitizeSignals(field.signals) })),
      actions: section.actions.map((action) => ({ ...action, text: redactCaptureText(action.text) })),
    })),
    globalActions: model.globalActions.map((action) => ({ ...action, text: redactCaptureText(action.text) })),
  }
}
