// Crash groups and reports for Mock API mode, one of each shape the admin pages render:
// a symbolicated panic, a panic without symbols, an unclean exit, a frontend error, a webview crash.
import type { CrashFilters, CrashGroup, CrashGroupDetail, CrashKind, CrashReportDetail, CrashStatus, CrashSymbolicatedFrame } from '../types'
import { isoAgo } from './fixtures'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const id = (n: number) => `00000000-0000-4000-8000-c0000000${n.toString(16).padStart(4, '0')}`

const SYMBOLICATED: CrashSymbolicatedFrame[] = [
  { module: 'watchdemo.exe', offset: '0x2b1f4', symbols: [{ function: 'watchdemo_lib::adapters::observability::crash::install::closure$0', file: 'src\\adapters\\observability\\crash.rs', line: 41, in_app: true }] },
  { module: 'watchdemo.exe', offset: '0x1d0c80', symbols: [{ function: 'std::panicking::panic_with_hook', file: '/rustc/library\\std\\src\\panicking.rs', line: 792, in_app: false }] },
  { module: 'watchdemo.exe', offset: '0x1d27a1', symbols: [{ function: 'core::option::unwrap_failed', file: '/rustc/library\\core\\src\\option.rs', line: 2015, in_app: false }] },
  {
    module: 'watchdemo.exe',
    offset: '0x8a3c2',
    symbols: [
      { function: 'watchdemo_lib::services::analysis::rounds::build_timeline', file: 'src\\services\\analysis\\rounds.rs', line: 212, in_app: true },
      { function: 'watchdemo_lib::services::analysis::rounds::analyze', file: 'src\\services\\analysis\\rounds.rs', line: 88, in_app: true },
    ],
  },
  { module: 'watchdemo.exe', offset: '0x8b010', symbols: [{ function: 'watchdemo_lib::services::analysis::run_analysis::closure$2', file: 'src\\services\\analysis\\mod.rs', line: 140, in_app: true }] },
  { module: 'watchdemo.exe', offset: '0x41ee0', symbols: [{ function: 'tokio::runtime::task::harness::Harness::poll', file: 'tokio\\src\\runtime\\task\\harness.rs', line: 151, in_app: false }] },
  { module: 'watchdemo.exe', offset: '0x3fff1', symbols: [] },
]

const LOG_TAIL = Array.from({ length: 60 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 9, 24, 9, 58, i)).toISOString()
  return `${t}  INFO watchdemo_lib::services::analysis: parsed tick ${i * 640} of 128000 in demo %USERPROFILE%\\Documents\\cs2\\match_${1700 + i}.dem`
}).join('\n')

type Shape = {
  kind: CrashKind
  code: string
  title: string
  status: CrashStatus
  count: number
  version: string
  firstDays: number
  lastHours: number
  resolved?: string
  notes?: string
  location?: string
  symbols?: boolean
  js?: string
}

const SHAPES: Shape[] = [
  { kind: 'panic', code: 'WD-CORE-001', title: 'called `Option::unwrap()` on a `None` value', status: 'new', count: 37, version: '0.8.1', firstDays: 6, lastHours: 2, location: 'src\\services\\analysis\\rounds.rs:212:41', symbols: true },
  { kind: 'panic', code: 'WD-DEMO-004', title: 'Demo parse failed: unexpected end of packet entities', status: 'in_progress', count: 12, version: '0.8.0-beta.2', firstDays: 19, lastHours: 30, location: 'src\\adapters\\demo\\parser.rs:503:17', notes: 'Только демки FACEIT после обновления 24.10. Воспроизводится на match_1734.dem.' },
  { kind: 'unclean_exit', code: 'WD-CORE-002', title: 'Previous session ended without a clean exit', status: 'new', count: 8, version: '0.8.1', firstDays: 3, lastHours: 9 },
  { kind: 'frontend', code: 'WD-UI-001', title: "TypeError: Cannot read properties of undefined (reading 'rounds')", status: 'resolved', count: 5, version: '0.8.0', firstDays: 40, lastHours: 24 * 12, resolved: '0.8.1', notes: 'Исправлено в 0.8.1: пустой матч без раундов.', js: "TypeError: Cannot read properties of undefined (reading 'rounds')\n    at RoundsList (http://tauri.localhost/assets/index-B7xK2a.js:41:20311)\n    at renderWithHooks (http://tauri.localhost/assets/index-B7xK2a.js:3:19112)\n    at updateFunctionComponent (http://tauri.localhost/assets/index-B7xK2a.js:3:44102)" },
  { kind: 'webview', code: 'WD-WEB-001', title: 'WebView2 process failed: RenderProcessExited', status: 'resolved', count: 2, version: '0.7.6', firstDays: 60, lastHours: 24 * 33, resolved: '0.8.0' },
  { kind: 'panic', code: 'WD-CORE-001', title: 'index out of bounds: the len is 0 but the index is 0', status: 'new', count: 3, version: '0.8.1', firstDays: 1, lastHours: 5, location: 'src\\services\\playback.rs:77:22', symbols: true },
]

export function buildCrashes(people: { id: string; email: string }[]) {
  const groups: CrashGroup[] = []
  const reports: CrashReportDetail[] = []
  SHAPES.forEach((s, gi) => {
    const groupId = id(gi + 1)
    groups.push({
      id: groupId,
      fingerprint: `${gi}`.padStart(64, 'f'),
      error_code: s.code,
      kind: s.kind,
      title: s.title,
      status: s.status,
      resolved_in_version: s.resolved ?? null,
      notes: s.notes ?? null,
      first_seen: isoAgo(s.firstDays * DAY),
      last_seen: isoAgo(s.lastHours * HOUR),
      report_count: s.count,
      last_app_version: s.version,
    })
    for (let ri = 0; ri < Math.min(s.count, 6); ri++) {
      const who = ri % 3 === 2 ? null : people[(gi + ri) % people.length]
      const at = isoAgo(s.lastHours * HOUR + ri * 7 * HOUR)
      const reportId = id(0x100 + gi * 16 + ri)
      const version = ri === 5 ? '0.8.0' : s.version
      const frames = s.kind === 'panic' ? SYMBOLICATED.map(({ module, offset }) => ({ module, offset })) : []
      reports.push({
        id: reportId,
        report_id: reportId.replace('c000', 'a000'),
        group_id: groupId,
        user_id: who?.id ?? null,
        user_email: who?.email ?? null,
        install_id: id(0x900 + ((gi + ri) % 5)),
        app_version: version,
        kind: s.kind,
        error_code: s.code,
        occurred_at: at,
        received_at: at,
        symbolicated: s.symbols ? SYMBOLICATED : null,
        payload: {
          report_id: reportId,
          kind: s.kind,
          error_code: s.code,
          message: s.title,
          location: s.location ?? null,
          frames,
          js_stack: s.js ?? null,
          app_version: version,
          os_version: ri % 2 ? 'Windows 10 19045' : 'Windows 11 26100',
          webview_version: '130.0.2849.80',
          locale: ri % 2 ? 'en' : 'ru',
          install_id: id(0x900 + ((gi + ri) % 5)),
          session_id: id(0x700 + ri),
          occurred_at: at,
          breadcrumbs: [
            { ts: at, category: 'nav', message: 'library -> replay' },
            { ts: at, category: 'ipc', message: 'list_demos' },
            { ts: at, category: 'ipc', message: 'analyze_demo' },
          ],
          log_tail: LOG_TAIL,
          user_comment: ri === 0 ? 'Открыл демку с FACEIT и нажал «Анализ», приложение закрылось.' : null,
        },
      })
    }
  })
  return { groups, reports }
}

/** GET /admin/crashes filtering and order, as web/SPI/db_adapter/repositories/crash_repo.py does it. */
export function filterCrashes(groups: CrashGroup[], reports: CrashReportDetail[], f: CrashFilters): CrashGroup[] {
  const to = f.to && new Date(Date.parse(`${f.to}T00:00:00Z`) + DAY).toISOString()
  const from = f.from && `${f.from}T00:00:00.000Z`
  return groups
    .filter((g) => !f.status || g.status === f.status)
    .filter((g) => !f.kind || g.kind === f.kind)
    .filter((g) => !f.error_code || g.error_code === f.error_code)
    .filter((g) => !f.version || reports.some((r) => r.group_id === g.id && r.app_version === f.version))
    .filter((g) => (!from || g.last_seen >= from) && (!to || g.last_seen < to))
    .sort((a, b) => (f.sort === 'count' ? b.report_count - a.report_count : b.last_seen.localeCompare(a.last_seen)))
}

export const groupDetail = (g: CrashGroup, reports: CrashReportDetail[]): CrashGroupDetail => ({
  ...g,
  reports: reports
    .filter((r) => r.group_id === g.id)
    .sort((a, b) => b.received_at.localeCompare(a.received_at))
    .slice(0, 50)
    .map(({ payload: _p, symbolicated: _s, group_id: _g, ...summary }) => summary),
})
