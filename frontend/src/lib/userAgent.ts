// Readable device names for the sessions list. The desktop app will send
// "WatchDemo/<version> (Windows)"; older builds send no User-Agent at all, and any
// non-browser string is treated as the app too.
import type { Dict } from '../i18n/ru.ts'
import { fmt } from '../i18n/fmt.ts'

export type Device =
  | { kind: 'app'; version: string | null }
  | { kind: 'browser'; browser: string; os: string | null; mobile: boolean }

const BROWSERS: [RegExp, string][] = [
  [/YaBrowser\//, 'Yandex Browser'],
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux|X11/, 'Linux'],
]

export function parseDevice(ua: string | null | undefined): Device {
  const app = ua?.match(/WatchDemo\/([\w.-]+)/)
  if (!ua || app || !/Mozilla\//.test(ua)) return { kind: 'app', version: app?.[1] ?? null }
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? 'Browser'
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? null
  return { kind: 'browser', browser, os, mobile: /Mobile|Android|iPhone/.test(ua) }
}

/** «Приложение WatchDemo 0.7.6 · Windows», «Firefox, Windows». The app ships for Windows only. */
export function deviceName(d: Device, t: Pick<Dict, 'device'>): string {
  if (d.kind === 'app') return `${d.version ? fmt(t.device.appVersion, { version: d.version }) : t.device.app} · Windows`
  return d.os ? fmt(t.device.browserOn, { browser: d.browser, os: d.os }) : d.browser
}
