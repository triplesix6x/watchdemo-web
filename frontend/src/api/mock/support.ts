// Mock support: tickets, the customer chat and images, with the rules of
// web/APP/services/support_service.py, whose set_status is the source of truth (one non-closed ticket per contact, a customer
// message reopens, a staff reply sets pending, notes stay internal).
// Error paths: a body of "fail" on a staff reply to a Telegram ticket -> delivery failed (403).
import type { StaffMessage, SupportChannel, SupportMessage, SupportTicket, SupportTicketDetail, TicketStatus } from '../types'
import { hasRole } from '../types'
import { Code } from '../errors'
import { ADMIN_ID, FREE_ID, PRO_ID, SUPPORT_ID, isoAgo, type MockUser } from './fixtures'
import type { MockRoute, MockHelpers } from './index'

type Contact = {
  id: string
  channel: SupportChannel
  user_id: string | null
  display_name: string
  tg_username: string | null
  tg_user_id: number | null
  blocked_at: string | null
  created_at: string
}
type Ticket = Omit<SupportTicket, 'channel' | 'contact_name' | 'tg_username' | 'preview' | 'preview_direction' | 'preview_has_image' | 'assignee_username'> & {
  contact_id: string
  resolved_at: string | null
}
type Message = StaffMessage & { ticket_id: string }

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const MAX_IMAGE = 10 * 1024 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** A screenshot-like placeholder for fixture images. */
function placeholder(label: string, hue: number): Blob {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="hsl(${hue} 30% 16%)"/><rect x="24" y="24" width="592" height="40" rx="6" fill="hsl(${hue} 30% 24%)"/><circle cx="320" cy="210" r="70" fill="none" stroke="hsl(${hue} 70% 60%)" stroke-width="6"/><text x="320" y="330" fill="#dde1e8" font-family="sans-serif" font-size="22" text-anchor="middle">${label}</text></svg>`
  return new Blob([svg], { type: 'image/svg+xml' })
}

export function makeSupportRoutes({ ok, msg, need, byId }: MockHelpers): MockRoute[] {
  const contacts: Contact[] = []
  const tickets: Ticket[] = []
  const messages: Message[] = []
  const images = new Map<string, Blob>()
  let seq = 1
  let number = 1040
  const id = (prefix: string) => `${prefix}-0000-4000-8000-${(seq++).toString(16).padStart(12, '0')}`

  const contact = (c: Omit<Contact, 'id' | 'blocked_at' | 'created_at'>, agoMs: number) => {
    const row: Contact = { id: id('c0000000'), blocked_at: null, created_at: isoAgo(agoMs), ...c }
    contacts.push(row)
    return row
  }
  const ticket = (c: Contact, status: TicketStatus, agoMs: number, extra: Partial<Ticket> = {}) => {
    const row: Ticket = {
      id: id('70000000'),
      number: number++,
      contact_id: c.id,
      status,
      unread_count: 0,
      waiting_since: null,
      assignee_id: null,
      resolved_at: null,
      last_activity_at: isoAgo(agoMs),
      created_at: isoAgo(agoMs),
      ...extra,
    }
    tickets.push(row)
    return row
  }
  const say = (t: Ticket, direction: Message['direction'], body: string, agoMs: number, extra: Partial<Message> = {}) => {
    const m: Message = {
      id: id('a0000000'),
      ticket_id: t.id,
      direction,
      body,
      image_url: null,
      author_id: direction === 'in' ? null : SUPPORT_ID,
      author_username: direction === 'in' ? null : 'support_anya',
      delivery: direction === 'out' ? 'sent' : null,
      delivery_error: null,
      edited_at: null,
      created_at: isoAgo(agoMs),
      ...extra,
    }
    messages.push(m)
    t.last_activity_at = m.created_at
    return m
  }
  const withImage = (m: Message, blob: Blob) => {
    images.set(m.id, blob)
    m.image_url = `/api/v1/support/images/${m.id}`
    return m
  }

  // Fixtures: the pro persona has a running conversation, others fill the inbox.
  const pro = contact({ channel: 'web', user_id: PRO_ID, display_name: 'player', tg_username: null, tg_user_id: null }, 20 * DAY)
  const old = ticket(pro, 'closed', 20 * DAY, { assignee_id: SUPPORT_ID })
  say(old, 'in', 'Не могу войти в приложение, пишет «Неверный логин или пароль», хотя на сайте вхожу.', 20 * DAY)
  say(old, 'out', 'Приложение принимает логин или почту. Попробуйте войти по почте и проверьте раскладку клавиатуры.', 20 * DAY - 2 * HOUR)
  const proNow = ticket(pro, 'open', 3 * HOUR, { unread_count: 2, waiting_since: isoAgo(3 * HOUR) })
  say(proNow, 'in', 'После обновления 2D-реплей показывает чёрный экран на Anubis.', 3 * HOUR)
  withImage(say(proNow, 'in', 'Вот как это выглядит:', 3 * HOUR - 2 * MIN), placeholder('2D replay: black screen', 220))

  const tg1 = contact({ channel: 'telegram', user_id: null, display_name: 'Артём Д.', tg_username: 'artem_d', tg_user_id: 512_330_901 }, 6 * DAY)
  const tgOpen = ticket(tg1, 'open', 26 * HOUR, { unread_count: 1, waiting_since: isoAgo(26 * HOUR) })
  say(tgOpen, 'in', 'F8 в игре не переключает моменты. Набор сохранил, CS2 открывается.', 26 * HOUR)
  say(tgOpen, 'note', 'Похоже на старые бинды: спросить, нажимал ли «Снять привязки».', 25 * HOUR)
  const tgPrev = ticket(tg1, 'closed', 6 * DAY)
  say(tgPrev, 'in', 'Как получить Pro?', 6 * DAY)
  say(tgPrev, 'out', 'Напишите имя аккаунта, выдадим вручную.', 6 * DAY - HOUR)

  const tg2 = contact({ channel: 'telegram', user_id: null, display_name: 'Mike', tg_username: null, tg_user_id: 700_100_200 }, 2 * DAY)
  const tgPending = ticket(tg2, 'pending', 2 * DAY, { assignee_id: ADMIN_ID })
  say(tgPending, 'in', 'Does the app work on Windows 10 LTSC?', 2 * DAY)
  say(tgPending, 'out', 'It should, as long as WebView2 is installed. Could you try and tell us?', 2 * DAY - 30 * MIN, { author_id: ADMIN_ID, author_username: 'zeroikins' })
  tg2.blocked_at = isoAgo(DAY)
  say(tgPending, 'out', 'Did it work?', DAY, { author_id: ADMIN_ID, author_username: 'admin', delivery: 'failed', delivery_error: '403: Forbidden: bot was blocked by the user' })

  const free = contact({ channel: 'web', user_id: FREE_ID, display_name: 'newbie', tg_username: null, tg_user_id: null }, 4 * DAY)
  const freeResolved = ticket(free, 'resolved', 4 * DAY, { assignee_id: SUPPORT_ID, resolved_at: isoAgo(30 * HOUR) })
  say(freeResolved, 'in', 'Установщик ругается на SmartScreen, это нормально?', 4 * DAY)
  say(freeResolved, 'out', 'Да, установщик пока не подписан. Нажмите «Подробнее», затем «Выполнить в любом случае».', 4 * DAY - HOUR)

  const tg3 = contact({ channel: 'telegram', user_id: null, display_name: 'Лёша', tg_username: 'lesha_t', tg_user_id: 811_000_333 }, 40 * MIN)
  const tgNew = ticket(tg3, 'open', 40 * MIN, { unread_count: 1, waiting_since: isoAgo(40 * MIN) })
  withImage(say(tgNew, 'in', '', 40 * MIN), placeholder('Import failed: archive.rar', 350))

  // ----- helpers -----
  const contactOf = (t: Ticket) => contacts.find((c) => c.id === t.contact_id)!
  const visible = (m: Message) => m.direction !== 'note'
  const username = (uid: string | null) => (uid ? byId(uid)?.username ?? null : null)
  const view = (t: Ticket): SupportTicket => {
    const c = contactOf(t)
    const last = messages.filter((m) => m.ticket_id === t.id && visible(m)).slice(-1)[0]
    const { contact_id: _c, resolved_at: _r, ...rest } = t
    return {
      ...rest,
      channel: c.channel,
      contact_name: c.user_id ? username(c.user_id) ?? c.display_name : c.display_name,
      tg_username: c.tg_username,
      preview: last?.body ?? null,
      preview_direction: (last?.direction as 'in' | 'out' | undefined) ?? null,
      preview_has_image: !!last?.image_url,
      assignee_username: username(t.assignee_id),
    }
  }
  const openTicketOf = (c: Contact) => tickets.find((t) => t.contact_id === c.id && t.status !== 'closed') ?? null
  const strip = ({ ticket_id: _t, ...m }: Message): StaffMessage => m
  const customerView = (m: Message): SupportMessage => ({ id: m.id, direction: m.direction as 'in' | 'out', body: m.body, image_url: m.image_url, created_at: m.created_at })

  type Ctx = Parameters<MockRoute[2]>[0]
  const readMessage = (c: Ctx): { body: string; image: File | null } | ReturnType<typeof msg> => {
    const f = c.req.form!
    const body = String(f.get('body') ?? '').trim()
    const image = (f.get('image') as File | null) || null
    if (body.length > 4000) return [422, { message: 'Validation failed', code: Code.VALIDATION_FAILED, detail: [{ loc: ['body', 'body'], type: 'string_too_long', ctx: { max_length: 4000 } }] }]
    if (image && !IMAGE_TYPES.includes(image.type)) return msg(422, Code.SUPPORT_IMAGE_INVALID, 'Only PNG, JPEG and WebP images')
    if (image && image.size > MAX_IMAGE) return msg(422, Code.SUPPORT_IMAGE_TOO_LARGE, 'Image is too large', { max_mb: 10 })
    if (!body && !image) return msg(422, Code.SUPPORT_EMPTY_MESSAGE, 'Write a message or attach an image')
    return { body, image }
  }
  const findTicket = (tid: string) => tickets.find((t) => t.id === tid) ?? null
  const notFound = () => msg(404, Code.SUPPORT_TICKET_NOT_FOUND, 'Ticket not found')
  const RESOLVED_CLOSE = 72 * HOUR

  return [
    ['GET', /^\/support\/messages$/, (c) => {
      const denied = need(c, 'user')
      if (denied) return denied
      const mine = contacts.find((x) => x.user_id === c.me!.id)
      const ids = new Set(tickets.filter((t) => t.contact_id === mine?.id).map((t) => t.id))
      const list = messages.filter((m) => ids.has(m.ticket_id) && visible(m)).sort((a, b) => a.created_at.localeCompare(b.created_at))
      const after = c.url.searchParams.get('after')
      const from = after ? list.findIndex((m) => m.id === after) + 1 : 0
      return ok(list.slice(from).map(customerView))
    }],
    ['POST', /^\/support\/messages$/, (c) => {
      const denied = need(c, 'user')
      if (denied) return denied
      const input = readMessage(c)
      if (Array.isArray(input)) return input
      let mine = contacts.find((x) => x.user_id === c.me!.id)
      mine ??= contact({ channel: 'web', user_id: c.me!.id, display_name: c.me!.username, tg_username: null, tg_user_id: null }, 0)
      let t = openTicketOf(mine)
      if (t?.status === 'resolved' && t.resolved_at && Date.now() - Date.parse(t.resolved_at) > RESOLVED_CLOSE) t.status = 'closed'
      t = openTicketOf(mine) ?? ticket(mine, 'open', 0)
      t.status = 'open'
      t.unread_count += 1
      t.waiting_since ??= new Date().toISOString()
      t.resolved_at = null
      const m = say(t, 'in', input.body, 0)
      if (input.image) withImage(m, input.image)
      return [201, customerView(m)]
    }],
    ['GET', /^\/support\/images\/([\w-]+)$/, (c) => {
      const denied = need(c, 'user')
      if (denied) return denied
      const m = messages.find((x) => x.id === c.params[0])
      const t = m && findTicket(m.ticket_id)
      const owner = t && contactOf(t).user_id === c.me!.id && visible(m)
      if (!m || !images.has(m.id) || !(owner || hasRole(c.me!.role, 'support'))) return msg(404, Code.SUPPORT_IMAGE_NOT_FOUND, 'Image not found')
      return [200, images.get(m.id)]
    }],
    ['GET', /^\/admin\/support\/unread$/, (c) => need(c, 'support') ?? ok({ tickets: tickets.filter((t) => t.unread_count > 0 && t.status !== 'closed').length })],
    ['GET', /^\/admin\/support\/tickets$/, (c) => {
      const denied = need(c, 'support')
      if (denied) return denied
      const status = c.url.searchParams.get('status')
      const channel = c.url.searchParams.get('channel')
      const q = (c.url.searchParams.get('q') ?? '').toLowerCase().replace(/^[#@]/, '')
      const list = tickets
        .filter((t) => (status ? t.status === status : t.status !== 'closed'))
        .map(view)
        .filter((t) => !channel || t.channel === channel)
        .filter((t) => !q || String(t.number) === q || t.contact_name.toLowerCase().includes(q) || (t.tg_username ?? '').includes(q))
        .sort(
          (a, b) =>
            Number(b.unread_count > 0) - Number(a.unread_count > 0) ||
            (a.waiting_since ?? '9').localeCompare(b.waiting_since ?? '9') ||
            b.last_activity_at.localeCompare(a.last_activity_at),
        )
      const page = Math.max(1, Number(c.url.searchParams.get('page') ?? 1))
      return ok({ items: list.slice((page - 1) * 50, page * 50), total: list.length, page, page_size: 50 })
    }],
    ['GET', /^\/admin\/support\/tickets\/([\w-]+)$/, (c) => {
      const denied = need(c, 'support')
      if (denied) return denied
      const t = findTicket(c.params[0])
      if (!t) return notFound()
      const ct = contactOf(t)
      const u: MockUser | null = ct.user_id ? byId(ct.user_id) : null
      const detail: SupportTicketDetail = {
        ticket: view(t),
        messages: messages.filter((m) => m.ticket_id === t.id).map(strip),
        contact: {
          id: ct.id,
          channel: ct.channel,
          display_name: ct.display_name,
          locale: 'ru',
          blocked_at: ct.blocked_at,
          created_at: ct.created_at,
          user: u ? { id: u.id, email: u.email, username: u.username, tier: u.subscription && !u.subscription.is_expired ? u.subscription.effective_tier : null } : null,
          tg_username: ct.tg_username,
          tg_user_id: ct.tg_user_id,
          other_tickets: ct.channel === 'telegram' ? tickets.filter((x) => x.contact_id === ct.id && x.id !== t.id).map((x) => ({ id: x.id, number: x.number, status: x.status, created_at: x.created_at })) : [],
        },
        assignees: [ADMIN_ID, SUPPORT_ID].map((uid) => ({ id: uid, username: username(uid) ?? uid })),
      }
      return ok(detail)
    }],
    ['POST', /^\/admin\/support\/tickets\/([\w-]+)\/messages$/, (c) => {
      const denied = need(c, 'support')
      if (denied) return denied
      const t = findTicket(c.params[0])
      if (!t) return notFound()
      const input = readMessage(c)
      if (Array.isArray(input)) return input
      const note = c.req.form!.get('note') === 'true'
      if (!note && t.status === 'closed') return msg(409, Code.SUPPORT_TICKET_CLOSED, 'Ticket is closed')
      const ct = contactOf(t)
      const failed = !note && ct.channel === 'telegram' && (input.body === 'fail' || !!ct.blocked_at)
      const m = say(t, note ? 'note' : 'out', input.body, 0, {
        author_id: c.me!.id,
        author_username: c.me!.username,
        delivery: note ? null : failed ? 'failed' : 'sent',
        delivery_error: failed ? '403: Forbidden: bot was blocked by the user' : null,
      })
      if (input.image) withImage(m, input.image)
      if (failed) ct.blocked_at = m.created_at
      if (!note) Object.assign(t, { status: 'pending', waiting_since: null, unread_count: 0, assignee_id: t.assignee_id ?? c.me!.id, resolved_at: null })
      return [201, strip(m)]
    }],
    ['PATCH', /^\/admin\/support\/tickets\/([\w-]+)$/, (c) => {
      const denied = need(c, 'support')
      if (denied) return denied
      const t = findTicket(c.params[0])
      if (!t) return notFound()
      const b = (c.req.body ?? {}) as { status?: TicketStatus; assignee_id?: string | null }
      if ('assignee_id' in b) {
        if (b.assignee_id && !hasRole(byId(b.assignee_id)?.role, 'support')) return msg(422, Code.SUPPORT_ASSIGNEE_INVALID, 'Assignee must be staff')
        t.assignee_id = b.assignee_id ?? null
      }
      if (b.status && b.status !== t.status) {
        if (t.status === 'closed' && tickets.some((x) => x.contact_id === t.contact_id && x.id !== t.id && x.status !== 'closed'))
          return msg(409, Code.SUPPORT_TICKET_CONFLICT, 'The contact already has another open ticket')
        t.status = b.status
        if (b.status === 'resolved') t.resolved_at = new Date().toISOString()
        if (b.status !== 'open') t.waiting_since = null
      }
      return ok(view(t))
    }],
    ['POST', /^\/admin\/support\/tickets\/([\w-]+)\/read$/, (c) => {
      const denied = need(c, 'support')
      if (denied) return denied
      const t = findTicket(c.params[0])
      if (!t) return notFound()
      t.unread_count = 0
      return ok()
    }],
  ]
}
