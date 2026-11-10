import path from 'node:path'
import fs from 'node:fs/promises'

export const ORIGIN = 'http://127.0.0.1:55450'
export const VERSION = 2
export const FIXED_TIME = '2026-05-20T12:00:00.000Z'
export const SEED = 240621
const route = (id, url, persona = 'anon', action = 'ready', storage = {}) => ({ id, url, persona, action, storage })
export const SCENARIOS = [
  route('home', '/'),
  route('home-scroll', '/', 'anon', 'home-scroll'),
  route('login', '/login'),
  route('route-history', '/login', 'anon', 'route-history'),
  route('login-validation', '/login', 'anon', 'login-validation'),
  route('login-error', '/login', 'anon', 'login-error'),
  route('login-success', '/login', 'anon', 'login-success'),
  route('register', '/register'),
  route('register-policy-error', '/register', 'anon', 'policy-error', { 'wd-mock-legal-case': 'policy-error' }),
  route('forgot-sent', '/forgot-password', 'anon', 'forgot-sent'),
  route('reset-missing', '/reset-password'),
  route('verify-bad', '/verify-email?token=bad', 'anon', 'token-error'),
  route('verify-expired', '/verify-email?token=expired', 'anon', 'token-error'),
  route('help', '/help'),
  route('help-search', '/help', 'anon', 'help-search'),
  route('changelog', '/changelog'),
  route('legal', '/legal/privacy'),
  route('account-pro', '/account', 'pro'),
  route('account-free', '/account', 'free'),
  route('account-redirect', '/account', 'anon', 'protected'),
  route('support', '/help', 'pro'),
  route('admin-users', '/admin/users', 'admin'),
  route('admin-empty', '/admin/users?q=__qa_no_match__', 'admin'),
  route('admin-detail-error', '/admin/users/not-a-user', 'admin', 'load-error'),
  route('admin-loading', '/admin/users', 'admin', 'loading', { 'wd-mock-delay': '3000' }),
  route('controls', '/__ui', 'admin', 'controls'),
  route('async-stale', '/__refactor-mounted.html', 'anon', 'async-stale'),
]
export const VIEWPORTS = [375, 390, 430, 1280, 1920]
const PRINCIPAL = new Set(['home', 'login', 'register', 'help', 'changelog', 'legal', 'account-pro', 'support', 'admin-users', 'controls'])
const REPRESENTATIVE = [390, 1280]
export function matrix() {
  return SCENARIOS.flatMap(s => (PRINCIPAL.has(s.id) ? VIEWPORTS : REPRESENTATIVE).flatMap(width => (s.id === 'controls' ? ['ru'] : ['ru', 'en']).flatMap(lang => {
    const representative = REPRESENTATIVE.includes(width)
    const motions = representative && ['home', 'controls'].includes(s.id) ? ['no-preference', 'reduce'] : ['no-preference']
    return motions.map(motion => ({ ...s, width, height: width < 600 ? 844 : 900, lang, motion,
      layer: PRINCIPAL.has(s.id) ? 'principal-layout' : 'state-boundary',
      rationale: PRINCIPAL.has(s.id) ? 'D25: principal layout across agreed widths; repeated noise probes only at representative widths' : 'D25: state/interaction boundary in RU and EN at representative mobile/desktop widths; redundant cross-products omitted',
      captures: PRINCIPAL.has(s.id) && representative && motion === 'no-preference' ? 3 : 1,
      key: `${s.id}-${width}-${lang}-${motion}` }))
  })))
}
export function selection({ mode, cases, budget }) {
  if (!['diagnostic', 'slice', 'full'].includes(mode)) throw Error('Explicit diagnostic, slice or full mode required')
  if (!Number.isInteger(budget) || budget < 1) throw Error('Positive integer artifact budget required')
  const all = matrix()
  const keys = cases ? cases.split(',') : []
  if (new Set(keys).size !== keys.length) throw Error('Duplicate selection')
  if (mode !== 'full' && !keys.length) throw Error('Explicit case keys required for incomplete runs')
  if (mode === 'full' && keys.length) throw Error('Full mode cannot omit cases')
  const selected = keys.length ? keys.map(key => {
    const found = all.find(c => c.key === key)
    if (!found) throw Error(`Unknown case: ${key}`)
    return found
  }) : all
  if (mode === 'diagnostic' && selected.length > 3) throw Error('Diagnostic limited to three cases')
  if (selected.reduce((n, c) => n + c.captures, 0) > budget) throw Error('Budget must allow the selected layered capture count')
  return selected
}
export function completeness(keys) {
  const expected = matrix().map(c => c.key)
  const seen = new Set(keys)
  return { missing: expected.filter(k => !seen.has(k)), unexpected: [...seen].filter(k => !expected.includes(k)), duplicated: [...seen].filter(k => keys.filter(x => x === k).length !== 1) }
}
export function requireURL(value) {
  const u = new URL(value)
  if (u.origin !== ORIGIN || u.username || u.password || u.protocol !== 'http:' || /(?:^|\/)api(?:\/|$)/i.test(decodeURIComponent(u.pathname))) throw Error('W1 request outside isolated mock origin')
  return u.href
}
function inside(parent, child) {
  const rel = path.relative(parent, child)
  return !rel || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}
// Reject every existing Git tree ancestor, not just this worktree. Canonicalize
// first so junctions/symlinks cannot turn an external-looking path into a repo.
export async function externalDirectory(value, { fresh = false } = {}) {
  if (!value || !path.isAbsolute(value)) throw Error('Absolute external directory required')
  const canonical = fresh ? path.join(await fs.realpath(path.dirname(value)), path.basename(value)) : await fs.realpath(value)
  let cursor = fresh ? path.dirname(canonical) : canonical
  while (true) {
    try { await fs.lstat(path.join(cursor, '.git')); throw Error('Artifacts must be outside all repositories') } catch (e) { if (e.code !== 'ENOENT') throw e }
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  if (fresh) await fs.mkdir(canonical)
  else if (!(await fs.stat(canonical)).isDirectory()) throw Error('Directory required')
  return canonical
}
export function disjointDirectories(a, b) {
  if (inside(a, b) || inside(b, a)) throw Error('Baseline and output must be disjoint')
}
export function compareRecords(expected, actual) {
  const captures = expected?.contract?.captures ?? 3
  if (![1, 3].includes(captures) || !expected || expected.key !== actual.key || expected.samples?.length !== captures || actual.samples?.length !== captures) throw Error('Missing or malformed expected case')
  const stable = [expected, actual].every(record => record.samples.every(s => s.png === record.samples[0].png && s.dom === record.samples[0].dom))
  const equal = actual.samples.every(s => s.png === expected.samples[0].png && s.dom === expected.samples[0].dom)
  return { stable, equal, noiseMeasured: captures === 3, status: !stable ? 'noise-unresolved' : equal ? 'exact-match-review-required' : 'regression-review-required' }
}
