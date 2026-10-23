// Formatting shared by pages. Dates in the UI language, sizes in binary units.
import type { Locale } from '../i18n'

const TAG: Record<Locale, string> = { ru: 'ru-RU', en: 'en-GB' }

/** 23 октября 2026 / 23 October 2026 */
export const formatDate = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleDateString(TAG[locale], { day: 'numeric', month: 'long', year: 'numeric' })

/** 23.10.2026, 14:05 */
export const formatDateTime = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleString(TAG[locale], { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** 23 окт. / 23 Oct, for a calendar day (`2026-10-23`, read as UTC). */
export const formatShortDate = (day: string, locale: Locale) =>
  new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString(TAG[locale], { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** окт. 2026 г. / Oct 2026 */
export const formatMonth = (iso: string, locale: Locale) => new Date(iso).toLocaleDateString(TAG[locale], { month: 'short', year: 'numeric' })

/** 41.2 МБ / 41.2 MB */
export function formatBytes(bytes: number, locale: Locale) {
  const units = locale === 'ru' ? ['Б', 'КБ', 'МБ', 'ГБ'] : ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toLocaleString(TAG[locale], { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`
}

export const formatNumber = (n: number, locale: Locale) => n.toLocaleString(TAG[locale])

/** 990 ₽ / RUB 990 */
export const formatPrice = (amount: number, currency: string, locale: Locale) =>
  amount.toLocaleString(TAG[locale], { style: 'currency', currency, maximumFractionDigits: 0 })

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]

/** "5 минут назад", "вчера", "через 3 дня", "сейчас"; more than 30 days away, the date. */
export function formatRelative(iso: string, locale: Locale, now = Date.now()): string {
  const secs = Math.round((Date.parse(iso) - now) / 1000)
  const abs = Math.abs(secs)
  if (abs > 30 * 86400) return formatDate(iso, locale)
  const rtf = new Intl.RelativeTimeFormat(TAG[locale], { numeric: 'auto' })
  if (abs < 45) return rtf.format(0, 'second')
  const [unit, size] = UNITS.find(([, s]) => abs >= s) ?? UNITS[2]
  return rtf.format(Math.round(secs / size), unit)
}
