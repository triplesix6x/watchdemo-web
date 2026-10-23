// Mock API (VITE_MOCK_API=1): an in-memory backend behind the same transport as fetch.
// State lives for the tab; reload resets it. Personas: localStorage['wd-mock-user'] =
// 'admin' (default) | 'moderator' | 'support' | 'pro' | 'free' | 'anon'. Latency: localStorage['wd-mock-delay'] ms.
// Error paths to exercise the UI (status codes as in web/APP/exception_handlers.py):
// login: password "wrong" -> 401 with attempts left (5 per login, then a 429 lockout),
//   "locked" -> 429 at once, login "unverified" -> 403 not verified;
// register / PATCH me: username "taken" or an existing email -> 409, a username with spaces -> 422;
// any new password: under 10 chars, no A-Z or no digit -> 422 password_weak with its rule;
// current password "wrong" (change password, change email, delete) -> 403 invalid_password;
// email links: token "bad" -> 401 invalid, "expired" -> 401 expired, "taken" -> 409.
import type { RawRequest, RawResponse } from '../client'
import type { AdminRelease, AdminStats, AdminUserListItem, Role, Session, Tier } from '../types'
import { TIERS, hasRole } from '../types'
import { Code, type ErrorCode } from '../errors'
import { ADMIN_ID, FREE_ID, MOD_ID, PRO_ID, SUPPORT_ID, buildAudit, buildReleases, buildSessions, buildSignups, buildUsers, type MockUser } from './fixtures'

export type Persona = 'admin' | 'moderator' | 'support' | 'pro' | 'free' | 'anon'
const PERSONA_ID: Record<Exclude<Persona, 'anon'>, string> = { admin: ADMIN_ID, moderator: MOD_ID, support: SUPPORT_ID, pro: PRO_ID, free: FREE_ID }
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      /* storage blocked: the persona just won't persist */
    }
  },
}

// `?mock-user=pro` in the first URL picks the persona too (screenshot scripts can't set storage).
const fromUrl = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('mock-user')
if (fromUrl) store.set('wd-mock-user', fromUrl)

export const getPersona = (): Persona => (store.get('wd-mock-user') as Persona) || 'admin'
/** Switch who the mock is signed in as. Reload the page afterwards. */
export function setPersona(p: Persona) {
  store.set('wd-mock-user', p)
}

const users = buildUsers()
const releases = buildReleases(ADMIN_ID)
const audit = buildAudit(users, releases)
const CURRENT_SID = '00000000-0000-4000-8000-00000000c0de'
let sessions = buildSessions(CURRENT_SID)
let signedInId: string | null = getPersona() === 'anon' ? null : PERSONA_ID[getPersona() as Exclude<Persona, 'anon'>]

const DAY = 86_400_000
type Ctx = { req: RawRequest; url: URL; params: string[]; me: MockUser | null }
type Result = [number, unknown?]
const ok = (data?: unknown): Result => [data === undefined ? 204 : 200, data]
const msg = (status: number, code: ErrorCode, message: string, extra: Record<string, unknown> = {}): Result => [status, { message, code, ...extra }]
const invalid = (field: string, type: string, text: string, ctx: Record<string, unknown> = {}): Result => [
  422,
  { message: 'Request validation failed', code: Code.VALIDATION_FAILED, detail: [{ loc: ['body', field], msg: text, type, ctx }] },
]

function token(u: MockUser): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, sid: CURRENT_SID, exp: Math.floor(Date.now() / 1000) + 900 })}.mock`
}
const publicUser = (u: MockUser) => {
  const { password: _pw, is_active: _a, ...rest } = u
  return rest
}
const listItem = (u: MockUser): AdminUserListItem => ({
  id: u.id,
  email: u.email,
  username: u.username,
  role: u.role,
  is_verified: u.is_verified,
  is_active: u.is_active,
  is_beta_tester: u.is_beta_tester,
  created_at: u.created_at,
  subscription: u.subscription,
})
const byId = (id: string) => users.find((u) => u.id === id) ?? null
const page = <T,>(items: T[], url: URL) => {
  const p = Math.max(1, Number(url.searchParams.get('page') ?? 1))
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get('page_size') ?? 25)))
  return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, page_size: size }
}
const body = <T,>(c: Ctx) => (c.req.body ?? {}) as T

function need(c: Ctx, min: Role): Result | null {
  if (!c.me) return msg(401, Code.TOKEN_MISSING, 'Authorization header missing')
  if (!hasRole(c.me.role, min)) return msg(403, Code.INSUFFICIENT_ROLE, 'Insufficient permissions')
  return null
}
function logAudit(c: Ctx, action: string, target: MockUser | null, details: Record<string, unknown> = {}) {
  audit.unshift({
    id: crypto.randomUUID(),
    actor_id: c.me!.id,
    actor_username: c.me!.username,
    action,
    target_user_id: target?.id ?? null,
    target_username: target?.username ?? null,
    details,
    ip_address: '127.0.0.1',
    created_at: new Date().toISOString(),
  })
}
function stats(): AdminStats {
  const tierOf = (u: MockUser) => (u.subscription && !u.subscription.is_expired ? u.subscription.effective_tier : null)
  const count = (f: (u: MockUser) => boolean) => users.filter(f).length
  return {
    total: users.length,
    verified: count((u) => u.is_verified),
    unverified: count((u) => !u.is_verified),
    active: count((u) => u.is_active),
    deactivated: count((u) => !u.is_active),
    tier_none: count((u) => !tierOf(u)),
    tier_basic: count((u) => tierOf(u) === 'basic'),
    tier_plus: count((u) => tierOf(u) === 'plus'),
    tier_pro: count((u) => tierOf(u) === 'pro'),
    paying: count((u) => tierOf(u) === 'plus' || tierOf(u) === 'pro'),
    signups_7d: count((u) => Date.now() - Date.parse(u.created_at) < 7 * DAY),
    signups_30d: count((u) => Date.now() - Date.parse(u.created_at) < 30 * DAY),
  }
}
function passwordIssue(pw: string): Result | null {
  if (pw.length < 10) return msg(422, Code.PASSWORD_WEAK, 'Password must be at least 10 characters', { rule: 'min_length', min_length: 10 })
  if (!/[A-Z]/.test(pw)) return msg(422, Code.PASSWORD_WEAK, 'Password must contain at least one uppercase Latin letter', { rule: 'uppercase' })
  if (!/\d/.test(pw)) return msg(422, Code.PASSWORD_WEAK, 'Password must contain at least one digit', { rule: 'digit' })
  return null
}
function usernameIssue(name: string | undefined): Result | null {
  const v = (name ?? '').trim()
  if (v.length < 3 || v.length > 50) return invalid('username', 'value_error', 'Value error, Username must be 3–50 characters')
  if (!/^[\p{L}\p{N}_-]+$/u.test(v)) return invalid('username', 'value_error', 'Value error, Username may only contain letters, digits, _ and -')
  return null
}
const failedLogins = new Map<string, number>()
const MAX_ATTEMPTS = 5
const tokenIssue = (token: string | null): Result | null =>
  token === 'bad' ? msg(401, Code.TOKEN_INVALID, 'Invalid or already used token') : token === 'expired' ? msg(401, Code.TOKEN_EXPIRED, 'Token expired') : null
function setSub(u: MockUser, tier: Tier, expires_at: string | null) {
  u.subscription = { tier, effective_tier: tier, started_at: new Date().toISOString(), expires_at, is_expired: false }
  return { id: crypto.randomUUID(), user_id: u.id, granted_by: ADMIN_ID, ...u.subscription }
}
const latest = (beta: boolean) => releases.find((r) => r.is_active && (r.channel === 'stable' || beta)) ?? null

// Admin target rules: 'strict' is get_modifiable_target (not yourself; a lower role, or an
// equal one for admins), 'notHigher' only refuses a higher role. Returns the target or an error.
function target(c: Ctx, rule: 'strict' | 'notHigher'): MockUser | Result {
  const denied = need(c, 'moderator')
  if (denied) return denied
  if (rule === 'strict' && c.params[0] === c.me!.id) return msg(403, Code.CANNOT_TARGET_SELF, 'Cannot perform this action on yourself')
  const u = byId(c.params[0])
  if (!u) return msg(404, Code.USER_NOT_FOUND, 'User not found')
  const higher = !hasRole(c.me!.role, u.role)
  const equal = u.role === c.me!.role
  if (rule === 'notHigher' && higher) return msg(403, Code.TARGET_ROLE_TOO_HIGH, 'Cannot modify a user with higher role')
  if (rule === 'strict' && (higher || (equal && c.me!.role !== 'admin'))) return msg(403, Code.TARGET_ROLE_TOO_HIGH, 'Cannot modify a user with equal or higher role')
  return u
}
// Other users' sessions: made once per user, kept until revoked.
const otherSessions = new Map<string, Session[]>()
function sessionsOf(u: MockUser, c: Ctx): Session[] {
  if (u.id === c.me!.id) return sessions
  if (!otherSessions.has(u.id)) {
    const n = u.is_active ? 1 + (parseInt(u.id.slice(-2), 16) % 4) : 0
    otherSessions.set(u.id, buildSessions(`${u.id.slice(0, -4)}5e50`).slice(0, n).map((s, i) => ({ ...s, id: `${u.id.slice(0, -4)}5e5${i}`, is_current: false })))
  }
  return otherSessions.get(u.id)!
}
function revokeAll(u: MockUser): number {
  const n = otherSessions.get(u.id)?.length ?? 0
  otherSessions.set(u.id, [])
  return n
}

type Route = [method: string, pattern: RegExp, handler: (c: Ctx) => Result]
const ROUTES: Route[] = [
  // auth
  ['POST', /^\/auth\/login$/, (c) => {
    const { login, password } = body<{ login: string; password: string }>(c)
    const key = (login ?? '').trim().toLowerCase()
    if (password === 'locked') return msg(429, Code.TOO_MANY_ATTEMPTS, 'Account locked due to too many failed attempts. Try again in 4 min 59 sec.', { retry_after_seconds: 299 })
    if (password === 'wrong') {
      const count = (failedLogins.get(key) ?? 0) + 1
      failedLogins.set(key, count)
      if (count >= MAX_ATTEMPTS) return msg(429, Code.TOO_MANY_ATTEMPTS, `Too many failed attempts. Account locked for ${MAX_ATTEMPTS} minutes.`, { retry_after_seconds: 300 })
      const left = MAX_ATTEMPTS - count
      return msg(401, Code.INVALID_CREDENTIALS, `Invalid credentials. ${left} attempt${left !== 1 ? 's' : ''} remaining before lockout.`, { attempts_remaining: left })
    }
    failedLogins.delete(key)
    if (key === 'unverified') return msg(403, Code.EMAIL_NOT_VERIFIED, 'Email address not verified')
    const u = users.find((x) => x.username === key || x.email === key) ?? byId(PRO_ID)!
    if (!u.is_verified) return msg(403, Code.EMAIL_NOT_VERIFIED, 'Email address not verified')
    if (!u.is_active) return msg(403, Code.ACCOUNT_DEACTIVATED, 'Account is deactivated')
    signedInId = u.id
    sessions = buildSessions(CURRENT_SID)
    return ok({ access_token: token(u), refresh_token: 'mock-rt', token_type: 'bearer', user: publicUser(u) })
  }],
  ['POST', /^\/auth\/register$/, (c) => {
    const b = body<{ email: string; username: string; password: string }>(c)
    if (!/^\S+@\S+\.\S+$/.test(b.email ?? '')) return invalid('email', 'value_error', 'value is not a valid email address')
    const nameIssue = usernameIssue(b.username)
    if (nameIssue) return nameIssue
    const name = (b.username ?? '').trim().toLowerCase()
    if (name === 'taken' || users.some((u) => u.username === name)) return msg(409, Code.USERNAME_TAKEN, 'Username already taken')
    if (users.some((u) => u.email === b.email)) return msg(409, Code.EMAIL_TAKEN, 'Email already registered')
    return passwordIssue(b.password ?? '') ?? [201, { message: 'Registration successful. Please check your email to verify your account.' }]
  }],
  ['POST', /^\/auth\/refresh$/, () => {
    const u = signedInId ? byId(signedInId) : null
    return u ? ok({ access_token: token(u), refresh_token: 'mock-rt', token_type: 'bearer' }) : msg(401, Code.TOKEN_MISSING, 'Refresh token required')
  }],
  ['POST', /^\/auth\/logout$/, () => {
    signedInId = null
    return ok()
  }],
  ['GET', /^\/auth\/verify-email$/, (c) => tokenIssue(c.url.searchParams.get('token')) ?? ok({ message: 'Email verified successfully' })],
  ['GET', /^\/auth\/confirm-email-change$/, (c) => {
    const token = c.url.searchParams.get('token')
    if (token === 'taken') return msg(409, Code.EMAIL_TAKEN, 'Email already registered')
    return tokenIssue(token) ?? ok({ message: 'Email changed successfully' })
  }],
  ['POST', /^\/auth\/forgot-password$/, () => [202, { message: 'If the email exists, a reset link was sent' }]],
  ['POST', /^\/auth\/reset-password$/, (c) => {
    const b = body<{ token: string; new_password: string }>(c)
    const bad = tokenIssue(b.token)
    if (bad) return bad
    return passwordIssue(b.new_password ?? '') ?? ok({ message: 'Password reset successfully' })
  }],
  ['POST', /^\/auth\/resend-verification$/, () => [202, { message: 'If the account exists, a new link was sent' }]],

  // me
  ['GET', /^\/users\/me$/, (c) => need(c, 'user') ?? ok(publicUser(c.me!))],
  ['PATCH', /^\/users\/me$/, (c) => {
    const denied = need(c, 'user')
    if (denied) return denied
    const b = body<{ username?: string; locale?: 'ru' | 'en' }>(c)
    if (b.username !== undefined) {
      const name = b.username.trim().toLowerCase()
      const issue = usernameIssue(name)
      if (issue) return issue
      if (users.some((u) => u.username === name && u.id !== c.me!.id) || name === 'taken') return msg(409, Code.USERNAME_TAKEN, 'Username already taken')
      c.me!.username = name
    }
    if (b.locale) c.me!.locale = b.locale
    return ok(publicUser(c.me!))
  }],
  ['POST', /^\/users\/me\/password$/, (c) => {
    const denied = need(c, 'user')
    if (denied) return denied
    const b = body<{ current_password: string; new_password: string; sign_out_others: boolean }>(c)
    if (b.current_password === 'wrong') return msg(403, Code.INVALID_PASSWORD, 'Invalid password')
    const issue = passwordIssue(b.new_password ?? '')
    if (issue) return issue
    if (b.sign_out_others) sessions = sessions.filter((s) => s.id === CURRENT_SID)
    return ok()
  }],
  ['POST', /^\/users\/me\/email$/, (c) => {
    const denied = need(c, 'user')
    if (denied) return denied
    const b = body<{ new_email: string; password: string }>(c)
    if (!/^\S+@\S+\.\S+$/.test(b.new_email ?? '')) return invalid('new_email', 'value_error', 'value is not a valid email address')
    if (b.password === 'wrong') return msg(403, Code.INVALID_PASSWORD, 'Invalid password')
    const email = b.new_email.trim().toLowerCase()
    if (email === c.me!.email) return msg(422, Code.EMAIL_UNCHANGED, 'New email matches the current one')
    if (users.some((u) => u.email === email)) return msg(409, Code.EMAIL_TAKEN, 'Email already registered')
    return [202, { message: 'Check the new address for a confirmation link' }]
  }],
  ['DELETE', /^\/users\/me$/, (c) => {
    const denied = need(c, 'user')
    if (denied) return denied
    const b = body<{ password: string; username: string }>(c)
    if (b.password === 'wrong') return msg(403, Code.INVALID_PASSWORD, 'Invalid password')
    if (b.username?.trim().toLowerCase() !== c.me!.username) return msg(422, Code.USERNAME_MISMATCH, 'Username does not match')
    c.me!.is_active = false
    signedInId = null
    return ok()
  }],
  ['GET', /^\/users\/me\/sessions$/, (c) => need(c, 'user') ?? ok(sessions)],
  ['DELETE', /^\/users\/me\/sessions\/([\w-]+)$/, (c) => {
    const denied = need(c, 'user')
    if (denied) return denied
    if (!sessions.some((s) => s.id === c.params[0])) return msg(404, Code.SESSION_NOT_FOUND, 'Session not found')
    sessions = sessions.filter((s) => s.id !== c.params[0])
    return ok()
  }],
  ['DELETE', /^\/users\/me\/sessions$/, (c) => {
    const denied = need(c, 'user')
    if (denied) return denied
    sessions = sessions.filter((s) => s.id === CURRENT_SID)
    return ok()
  }],

  // public app
  ['GET', /^\/app\/latest$/, (c) => {
    const r = latest(!!c.me?.is_beta_tester)
    if (!r) return msg(404, Code.RELEASE_NOT_FOUND, 'No release available')
    const { version, channel, url, file_name, file_size, sha256, published_at, notes } = r
    return ok({ version, channel, url, file_name, file_size, sha256, published_at, notes })
  }],
  ['GET', /^\/app\/releases$/, (c) => {
    const channel = c.url.searchParams.get('channel') ?? 'stable'
    const limit = Number(c.url.searchParams.get('limit') ?? 20)
    return ok(
      releases
        .filter((r) => r.is_active && r.show_in_changelog && r.channel === channel)
        .slice(0, limit)
        .map(({ version, channel, published_at, notes }) => ({ version, channel, published_at, notes })),
    )
  }],
  ['GET', /^\/app\/tiers$/, () => {
    const features = [
      ['demo_import', 'basic'],
      ['content_search', 'basic'],
      ['replay2d', 'plus'],
      ['advanced_stats', 'pro'],
    ] as const
    const limits: Record<string, number> = { 'demo_import:basic': 10, 'demo_import:plus': 100 }
    return ok({
      tiers: TIERS.map((id, rank) => ({
        id,
        features: features.map(([f, min]) => ({ id: f, allowed: rank >= TIERS.indexOf(min), min_tier: min, monthly_limit: limits[`${f}:${id}`] ?? null })),
      })),
    })
  }],

  // admin (rules mirror web/APP/services/admin_service.py and views/admin/views.py)
  ['GET', /^\/admin\/stats$/, (c) => need(c, 'support') ?? ok(stats())],
  ['GET', /^\/admin\/stats\/timeseries$/, (c) => {
    const denied = need(c, 'support')
    if (denied) return denied
    const days = Number(c.url.searchParams.get('days') ?? 30) === 90 ? 90 : 30
    const s = stats()
    const soon = users
      .filter((u) => u.subscription?.expires_at && !u.subscription.is_expired && Date.parse(u.subscription.expires_at) - Date.now() < 7 * DAY)
      .sort((a, b) => a.subscription!.expires_at!.localeCompare(b.subscription!.expires_at!))
      .map((u) => ({ user_id: u.id, username: u.username, tier: u.subscription!.tier, expires_at: u.subscription!.expires_at! }))
    return ok({ signups: buildSignups(days), tiers: { none: s.tier_none, basic: s.tier_basic, plus: s.tier_plus, pro: s.tier_pro }, expiring_soon: soon })
  }],
  ['GET', /^\/admin\/users$/, (c) => {
    const denied = need(c, 'support')
    if (denied) return denied
    const q = (c.url.searchParams.get('q') ?? '').toLowerCase()
    const role = c.url.searchParams.get('role')
    const verified = c.url.searchParams.get('verified')
    const active = c.url.searchParams.get('active')
    const tier = c.url.searchParams.get('tier')
    const list = users
      .filter((u) => !q || u.username.includes(q) || u.email.toLowerCase().includes(q))
      .filter((u) => !role || u.role === role)
      .filter((u) => verified === null || String(u.is_verified) === verified)
      .filter((u) => active === null || String(u.is_active) === active)
      .filter((u) => !tier || (tier === 'none' ? !u.subscription : u.subscription?.tier === tier))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(listItem)
    return ok(page(list, c.url))
  }],
  ['GET', /^\/admin\/users\/([\w-]+)$/, (c) => {
    const denied = need(c, 'support')
    if (denied) return denied
    const u = byId(c.params[0])
    if (!u) return msg(404, Code.USER_NOT_FOUND, 'User not found')
    const history = c.me!.role === 'admin' ? audit.filter((a) => a.target_user_id === u.id).slice(0, 50) : []
    return ok({ ...listItem(u), sessions: sessionsOf(u, c), audit: history })
  }],
  ['PATCH', /^\/admin\/users\/([\w-]+)\/active$/, (c) => {
    const t = target(c, 'strict')
    if (Array.isArray(t)) return t
    t.is_active = body<{ is_active: boolean }>(c).is_active
    if (!t.is_active) revokeAll(t)
    logAudit(c, t.is_active ? 'activate_user' : 'deactivate_user', t, { is_active: t.is_active })
    return ok(listItem(t))
  }],
  ['PATCH', /^\/admin\/users\/([\w-]+)\/beta$/, (c) => {
    const t = target(c, 'notHigher')
    if (Array.isArray(t)) return t
    t.is_beta_tester = body<{ is_beta_tester: boolean }>(c).is_beta_tester
    logAudit(c, t.is_beta_tester ? 'grant_beta' : 'revoke_beta', t, { is_beta_tester: t.is_beta_tester })
    return ok(listItem(t))
  }],
  ['POST', /^\/admin\/users\/role$/, (c) => {
    const denied = need(c, 'admin')
    if (denied) return denied
    const b = body<{ user_id: string; role: Role }>(c)
    const u = byId(b.user_id)
    if (!u) return msg(404, Code.USER_NOT_FOUND, 'User not found')
    u.role = b.role
    logAudit(c, 'grant_role', u, { role: b.role })
    return ok({ id: u.id, username: u.username, email: u.email, role: u.role })
  }],
  ['POST', /^\/admin\/subscriptions\/grant$/, (c) => {
    const denied = need(c, 'moderator')
    if (denied) return denied
    const b = body<{ user_id?: string; username?: string; tier: Tier; expires_at?: string | null }>(c)
    const u = b.user_id ? byId(b.user_id) : users.find((x) => x.username === b.username) ?? null
    if (!u) return msg(404, Code.USER_NOT_FOUND, 'User not found')
    logAudit(c, 'grant_subscription', u, { tier: b.tier, expires_at: b.expires_at ?? null })
    return ok(setSub(u, b.tier, b.expires_at ?? null))
  }],
  ['POST', /^\/admin\/subscriptions\/extend$/, (c) => {
    const denied = need(c, 'moderator')
    if (denied) return denied
    const b = body<{ user_id: string; days: number }>(c)
    if (!Number.isInteger(b.days) || b.days < 1 || b.days > 3650) return invalid('days', 'less_than_equal', 'Input should be less than or equal to 3650')
    const u = byId(b.user_id)
    if (!u?.subscription) return msg(404, Code.SUBSCRIPTION_NOT_FOUND, 'Subscription not found')
    if (u.subscription.tier === 'basic') return msg(422, Code.TIER_HAS_NO_EXPIRY, 'Basic tier has no expiry to extend')
    if (!u.subscription.expires_at) return msg(422, Code.SUBSCRIPTION_NO_EXPIRY, 'Subscription has no expiry')
    const from = Math.max(Date.now(), Date.parse(u.subscription.expires_at))
    const res = setSub(u, u.subscription.tier, new Date(from + b.days * DAY).toISOString())
    logAudit(c, 'extend_subscription', u, { days: b.days, tier: res.tier, expires_at: res.expires_at })
    return ok(res)
  }],
  ['POST', /^\/admin\/subscriptions\/revoke$/, (c) => {
    const denied = need(c, 'moderator')
    if (denied) return denied
    const u = byId(body<{ user_id: string }>(c).user_id)
    if (!u) return msg(404, Code.USER_NOT_FOUND, 'User not found')
    const previous = u.subscription?.tier ?? null
    const res = setSub(u, 'basic', null)
    logAudit(c, 'revoke_subscription', u, { previous_tier: previous })
    return ok(res)
  }],
  ['DELETE', /^\/admin\/users\/([\w-]+)\/sessions$/, (c) => {
    const t = target(c, 'strict')
    if (Array.isArray(t)) return t
    logAudit(c, 'revoke_sessions', t, { count: revokeAll(t) })
    return ok()
  }],
  ['POST', /^\/admin\/users\/([\w-]+)\/password-reset$/, (c) => {
    const t = target(c, 'strict')
    if (Array.isArray(t)) return t
    if (!t.is_active) return msg(403, Code.TARGET_DEACTIVATED, 'Account is deactivated')
    logAudit(c, 'send_password_reset', t)
    return [202, { message: 'Password reset email sent' }]
  }],
  ['POST', /^\/admin\/users\/([\w-]+)\/verify$/, (c) => {
    const t = target(c, 'notHigher')
    if (Array.isArray(t)) return t
    t.is_verified = true
    logAudit(c, 'verify_user', t)
    return ok(listItem(t))
  }],
  ['GET', /^\/admin\/audit$/, (c) => need(c, 'admin') ?? ok(page(audit, c.url))],
  ['GET', /^\/admin\/releases$/, (c) => {
    const denied = need(c, 'moderator')
    if (denied) return denied
    const ch = c.url.searchParams.get('channel')
    return ok(page(releases.filter((r) => !ch || r.channel === ch), c.url))
  }],
  ['POST', /^\/admin\/releases$/, (c) => {
    const denied = need(c, 'admin')
    if (denied) return denied
    const f = c.req.form!
    const file = f.get('installer') as File | null
    const version = String(f.get('version') ?? '').trim()
    const target = String(f.get('target') ?? 'windows')
    const arch = String(f.get('arch') ?? 'x86_64')
    const sig = f.get('signature_file') ? 'file' : String(f.get('signature') ?? '').trim()
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) return msg(422, Code.RELEASE_BAD_VERSION, `Invalid version: '${version}'`)
    if (!['windows', 'linux', 'darwin'].includes(target) || !['x86_64', 'aarch64', 'i686', 'armv7'].includes(arch)) return msg(422, Code.RELEASE_BAD_PLATFORM, `Unknown platform: ${target}/${arch}`)
    if (!sig) return msg(422, Code.RELEASE_BAD_SIGNATURE, 'Empty release signature')
    if (releases.some((r) => r.version === version && r.target === target && r.arch === arch)) return msg(409, Code.RELEASE_DUPLICATE, `Release ${version} for ${target}/${arch} is already published`)
    if (!file || !file.size) return msg(422, Code.RELEASE_EMPTY_FILE, 'Empty installer file')
    const channel = (f.get('channel') as 'stable' | 'beta') ?? 'stable'
    const r: AdminRelease = {
      id: crypto.randomUUID(),
      version,
      channel,
      target,
      arch,
      file_name: file.name,
      file_size: file.size,
      sha256: 'f'.repeat(64),
      notes: (f.get('notes') as string | null) || null,
      is_active: true,
      show_in_changelog: true,
      published_at: new Date().toISOString(),
      published_by: c.me!.id,
      url: `/releases/${version}/${file.name}`,
    }
    releases.unshift(r)
    logAudit(c, 'publish_release', null, { version, channel, target, arch, sha256: r.sha256 })
    return [201, r]
  }],
  ['PATCH', /^\/admin\/releases\/([\w-]+)\/active$/, (c) => {
    const denied = need(c, 'admin')
    if (denied) return denied
    const r = releases.find((x) => x.id === c.params[0])
    if (!r) return msg(404, Code.RELEASE_NOT_FOUND, 'Release not found')
    r.is_active = body<{ is_active: boolean }>(c).is_active
    logAudit(c, r.is_active ? 'activate_release' : 'deactivate_release', null, { version: r.version, is_active: r.is_active })
    return ok(r)
  }],
  ['PATCH', /^\/admin\/releases\/([\w-]+)$/, (c) => {
    const denied = need(c, 'admin')
    if (denied) return denied
    const r = releases.find((x) => x.id === c.params[0])
    if (!r) return msg(404, Code.RELEASE_NOT_FOUND, 'Release not found')
    const b = body<{ notes?: string | null; show_in_changelog?: boolean }>(c)
    if ('notes' in b) r.notes = b.notes ?? null
    if (b.show_in_changelog !== undefined) r.show_in_changelog = b.show_in_changelog
    logAudit(c, 'update_release', null, { version: r.version, fields: Object.keys(b).sort() })
    return ok(r)
  }],
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function mockSend(req: RawRequest): Promise<RawResponse> {
  const url = new URL(req.path, 'http://mock')
  await sleep(Number(store.get('wd-mock-delay') ?? 280))
  // Upload progress for the release form, in five steps.
  if (req.form && req.onProgress) for (const p of [20, 45, 70, 90, 100]) (req.onProgress(p), await sleep(120))
  const me = req.token && signedInId ? byId(signedInId) : null
  for (const [method, re, handler] of ROUTES) {
    const m = method === req.method ? re.exec(url.pathname) : null
    if (!m) continue
    const [status, data] = handler({ req, url, params: m.slice(1), me })
    if (import.meta.env.DEV) console.debug('[mock]', req.method, req.path, status)
    return { status, data: data ?? null }
  }
  return { status: 404, data: { message: `Mock: no handler for ${req.method} ${url.pathname}`, code: Code.HTTP_ERROR } }
}

