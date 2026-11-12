export const MAX_NOTICE_LENGTH = 500
export type MaintenanceSettings = { enabled: boolean; text_ru: string; text_en: string }
export type PublicNotice = { enabled: boolean; text: string }
export type NoticeField = 'text_ru' | 'text_en'
export type NoticeProblem = 'required' | 'length' | 'plain'

const formatting = /[<>`]|\*{1,2}[^*\n]+\*{1,2}|_{1,2}[^_\n]+_{1,2}|~~[^~\n]+~~|^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>)|!?\[[^\]]*\]\([^)]*\)/m
const link = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:|tel:|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\b|\/)|\b\d{1,3}(?:\.\d{1,3}){3}\b)/i
export const normalizeText = (text: string): string => text.replace(/\r\n?/g, '\n').trim()
export const textLength = (text: string): number => Array.from(text).length

export function textProblem(text: string): NoticeProblem | null {
  const normalized = normalizeText(text)
  if (textLength(text) > MAX_NOTICE_LENGTH) return 'length'
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized) || formatting.test(normalized) || link.test(normalized)) return 'plain'
  return null
}

export function validateSettings(settings: MaintenanceSettings): Partial<Record<NoticeField, NoticeProblem>> {
  const errors: Partial<Record<NoticeField, NoticeProblem>> = {}
  for (const field of ['text_ru', 'text_en'] as const) {
    const problem = textProblem(settings[field])
    if (problem) errors[field] = problem
  }
  if (settings.enabled && !normalizeText(settings.text_ru)) errors.text_ru = 'required'
  return errors
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
export function parseSettings(value: unknown): MaintenanceSettings {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || typeof value.text_ru !== 'string' || typeof value.text_en !== 'string') {
    throw new Error('Invalid maintenance settings response')
  }
  const settings = { enabled: value.enabled, text_ru: value.text_ru, text_en: value.text_en }
  if (Object.keys(validateSettings(settings)).length) throw new Error('Invalid maintenance settings text')
  return settings
}

export function parsePublicNotice(value: unknown): PublicNotice {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || typeof value.text !== 'string'
    || textProblem(value.text) || (value.enabled && !normalizeText(value.text))) {
    throw new Error('Invalid public maintenance response')
  }
  return { enabled: value.enabled, text: value.enabled ? value.text : '' }
}
