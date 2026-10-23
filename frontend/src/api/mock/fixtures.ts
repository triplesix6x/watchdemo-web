// Deterministic fixtures for Mock API mode. A seeded PRNG keeps every reload identical,
// so screenshots compare across runs. Dates are relative to "now".
import type { AdminRelease, AuditItem, Role, Session, Tier, User } from '../types'

let seed = 20261023
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
const DAY = 86_400_000
export const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString()
export const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString()
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

export type MockUser = User & {
  is_active: boolean
  is_beta_tester: boolean
  created_at: string
  password: string
}

const NAMES = [
  'dimon_awp', 'kirill-k', 'sasha_entry', 'lurker228', 'tema_igl', 'nikita_cs', 'v1ktor', 'retake_king',
  'mirage_main', 'smokecriminal', 'ankara', 'oleg_flash', 'kostya-b', 'demo_nerd', 'clutchmaster', 'ivan_rifler',
  'pasha_k', 'denis-coach', 'utility_only', 'max_anubis', 'roma_sniper', 'lesha_t', 'grisha_ct', 'misha_inferno',
  'yegor_lan', 'stepan_m', 'artem_d', 'boris_pro', 'fedya-ancient', 'gleb_nuke', 'timur_r', 'danya_s',
  'anton-v', 'egor_review', 'sergey_analyst', 'vlad_pug',
]
const DOMAINS = ['gmail.com', 'yandex.ru', 'mail.ru', 'proton.me', 'outlook.com']

function sub(tier: Tier, startedDaysAgo: number, expiresInDays: number | null): User['subscription'] {
  const expires = expiresInDays === null ? null : isoIn(expiresInDays * DAY)
  const isExpired = expiresInDays !== null && expiresInDays < 0
  return {
    tier,
    effective_tier: isExpired ? 'basic' : tier,
    started_at: isoAgo(startedDaysAgo * DAY),
    expires_at: expires,
    is_expired: isExpired,
  }
}

function makeUser(n: number, u: Partial<MockUser> & { username: string }): MockUser {
  return {
    id: uuid(n),
    email: `${u.username.replace(/[^a-z0-9]/g, '.')}@${pick(DOMAINS)}`,
    role: 'user',
    is_verified: true,
    is_active: true,
    is_beta_tester: false,
    locale: 'ru',
    subscription: null,
    created_at: isoAgo(Math.floor(rnd() * 88 * DAY) + DAY),
    password: 'Password123',
    ...u,
  }
}

/** Personas the mock signs in as: staff (admin, support, moderator) and two regular users. */
export const ADMIN_ID = uuid(1)
export const PRO_ID = uuid(2)
export const FREE_ID = uuid(3)
export const SUPPORT_ID = uuid(4)
export const MOD_ID = uuid(5)

export function buildUsers(): MockUser[] {
  const users: MockUser[] = [
    makeUser(1, { username: 'zeroikins', email: 'zeroikins@watchdemo.pro', role: 'admin', is_beta_tester: true, subscription: sub('pro', 300, null), created_at: isoAgo(420 * DAY) }),
    makeUser(2, { username: 'player', email: 'player@gmail.com', subscription: sub('pro', 20, 41), created_at: isoAgo(160 * DAY), is_beta_tester: true }),
    makeUser(3, { username: 'newbie', email: 'newbie@yandex.ru', created_at: isoAgo(2 * DAY) }),
    makeUser(4, { username: 'support_anya', role: 'support', subscription: sub('plus', 90, 120) }),
    makeUser(5, { username: 'mod_ilya', role: 'moderator', subscription: sub('pro', 200, null) }),
  ]
  NAMES.forEach((username, i) => {
    const roll = rnd()
    const tier: Tier | null = roll < 0.35 ? null : roll < 0.6 ? 'basic' : roll < 0.82 ? 'plus' : 'pro'
    const expiresIn = tier ? (rnd() < 0.15 ? Math.ceil(rnd() * 7) : rnd() < 0.1 ? -Math.ceil(rnd() * 20) : Math.ceil(rnd() * 200)) : null
    users.push(
      makeUser(10 + i, {
        username,
        is_verified: rnd() > 0.12,
        is_active: rnd() > 0.06,
        is_beta_tester: rnd() < 0.15,
        locale: rnd() < 0.8 ? 'ru' : 'en',
        subscription: tier ? sub(tier, Math.ceil(rnd() * 60), tier === 'basic' ? null : expiresIn) : null,
      }),
    )
  })
  return users
}

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0'
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1'

/** Sessions of the signed-in persona: this browser, the desktop app, two more browsers. */
export function buildSessions(currentSid: string): Session[] {
  return [
    { id: currentSid, device_info: CHROME, ip_address: '85.143.12.40', created_at: isoAgo(3 * DAY), last_used_at: isoAgo(60_000), expires_at: isoIn(27 * DAY), is_current: true },
    { id: uuid(9001), device_info: 'WatchDemo/0.7.6 (Windows)', ip_address: '85.143.12.40', created_at: isoAgo(12 * DAY), last_used_at: isoAgo(2 * 3_600_000), expires_at: isoIn(18 * DAY), is_current: false },
    { id: uuid(9002), device_info: null, ip_address: '85.143.12.40', created_at: isoAgo(40 * DAY), last_used_at: isoAgo(9 * DAY), expires_at: isoIn(2 * DAY), is_current: false },
    { id: uuid(9003), device_info: FIREFOX, ip_address: '178.66.201.7', created_at: isoAgo(6 * DAY), last_used_at: isoAgo(DAY + 3_600_000), expires_at: isoIn(24 * DAY), is_current: false },
    { id: uuid(9004), device_info: SAFARI_IOS, ip_address: '31.173.84.112', created_at: isoAgo(15 * DAY), last_used_at: isoAgo(4 * DAY), expires_at: isoIn(15 * DAY), is_current: false },
  ]
}

const NOTES_076 = `- Плейлисты моментов: отметьте раунды в 2D и проиграйте весь набор в CS2 клавишами F8 и F7.
- 2D-реплей показывает голосовой чат команды синхронно с раундом.
- Поиск по библиотеке находит демки по игроку, карте и счёту.
- Исправлено: после импорта папки список иногда не обновлялся до перезапуска.`

const NOTES = [
  NOTES_076,
  `- Авто-моменты: открытия, клатчи и мультикиллы собираются при разборе демки.\n- Быстрее разбор больших демок с FACEIT.`,
  `- Заметки к демке и группы в библиотеке.\n- Исправлено: в 2D-реплее терялись гранаты на Anubis.`,
  `- Первая публичная версия: библиотека демок и просмотр в CS2 в один клик.`,
]

export function buildReleases(adminId: string): AdminRelease[] {
  const rows: [string, 'stable' | 'beta', number, string | null, boolean, boolean][] = [
    ['0.8.0-beta.2', 'beta', 2, '- Тестовая сборка: новый движок разбора, нужен отзыв по скорости.', true, true],
    ['0.7.6', 'stable', 6, NOTES[0], true, true],
    ['0.7.5', 'stable', 21, NOTES[1], true, true],
    ['0.7.4', 'stable', 34, '- Исправления стабильности.', true, false],
    ['0.7.3', 'stable', 48, NOTES[2], false, true],
    ['0.7.0', 'stable', 75, NOTES[3], true, true],
  ]
  return rows.map(([version, channel, daysAgo, notes, isActive, show], i) => {
    const file = `WatchDemo_${version}_x64-setup.exe`
    return {
      id: uuid(5000 + i),
      version,
      channel,
      target: 'windows',
      arch: 'x86_64',
      file_name: file,
      file_size: 38_000_000 + Math.floor(rnd() * 6_000_000),
      sha256: Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join(''),
      notes,
      is_active: isActive,
      show_in_changelog: show,
      published_at: isoAgo(daysAgo * DAY + 5 * 3_600_000),
      published_by: adminId,
      url: `/releases/${version}/${file}`,
    }
  })
}

const ACTIONS: { action: string; details: (u: MockUser) => Record<string, unknown> }[] = [
  { action: 'grant_subscription', details: () => ({ tier: pick(['basic', 'plus', 'pro']), expires_at: isoIn(30 * DAY) }) },
  { action: 'extend_subscription', details: () => ({ days: pick([7, 30, 90]) }) },
  { action: 'revoke_subscription', details: () => ({ previous_tier: pick(['plus', 'pro']) }) },
  { action: 'grant_beta', details: () => ({ is_beta_tester: true }) },
  { action: 'revoke_beta', details: () => ({ is_beta_tester: false }) },
  { action: 'deactivate_user', details: () => ({ is_active: false }) },
  { action: 'activate_user', details: () => ({ is_active: true }) },
  { action: 'grant_role', details: () => ({ role: pick<Role>(['support', 'moderator', 'user']) }) },
  { action: 'revoke_sessions', details: () => ({ count: 1 + Math.floor(rnd() * 4) }) },
  { action: 'send_password_reset', details: () => ({}) },
  { action: 'verify_user', details: () => ({}) },
]

export function buildAudit(users: MockUser[], releases: AdminRelease[]): AuditItem[] {
  const staff = users.filter((u) => u.role !== 'user')
  const items: AuditItem[] = []
  for (let i = 0; i < 64; i++) {
    const actor = pick(staff)
    const target = pick(users)
    const a = pick(ACTIONS)
    items.push({
      id: uuid(7000 + i),
      actor_id: actor.id,
      actor_username: actor.username,
      action: a.action,
      target_user_id: target.id,
      target_username: target.username,
      details: a.details(target),
      ip_address: pick(['85.143.12.40', '10.0.0.4', '178.66.201.7']),
      created_at: isoAgo(i * 0.9 * DAY + Math.floor(rnd() * 5 * 3_600_000)),
    })
  }
  for (const r of releases) {
    items.push({
      id: uuid(8000 + items.length),
      actor_id: ADMIN_ID,
      actor_username: 'zeroikins',
      action: 'publish_release',
      target_user_id: null,
      target_username: null,
      details: { version: r.version, channel: r.channel, target: r.target, arch: r.arch, sha256: r.sha256 },
      ip_address: '85.143.12.40',
      created_at: r.published_at,
    })
  }
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** Daily signups for the last `days` days, with a weekly rhythm and a release bump. */
export function buildSignups(days: number) {
  const out: { date: string; count: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY)
    const weekday = d.getUTCDay()
    const base = 3 + (weekday === 0 || weekday === 6 ? 3 : 0)
    const bump = i < 8 ? 6 - Math.floor(i * 0.7) : 0
    out.push({ date: d.toISOString().slice(0, 10), count: Math.max(0, Math.round(base + bump + (Math.sin(i * 1.7) + 1) * 2)) })
  }
  return out
}
