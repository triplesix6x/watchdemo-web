// Support inbox: the ticket list on the left, the open ticket on the right
// (/admin/support/<id>). Both poll every 10 s while the tab is visible.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Globe, Inbox, MessageSquareOff, Send as TelegramIcon } from 'lucide-react'
import { supportAdminApi } from '../../api/endpoints'
import { ApiError } from '../../api/errors'
import { TICKET_STATUSES, type Paginated, type StaffMessage, type SupportChannel, type SupportTicket, type SupportTicketDetail, type SupportTicketFilters, type TicketStatus } from '../../api/types'
import { Head } from '../../head/Head'
import { LocalLink, fmt, useLocale, useT } from '../../i18n'
import { formatDateTime, formatRelative } from '../../lib/format'
import { usePoll } from '../../lib/usePoll'
import { useAsync, type AsyncState } from '../../lib/useAsync'
import { Button, DelayedReveal, EmptyState, Field, Input, LoadError, PageHead, Pill, Select, Skeleton, Switch, TierBadge, useToast, type PillTone } from '../../ui'
import { useAdminDict, type AdminDict } from '../../features/admin/useAdmin'
import { Composer } from '../../features/support/Composer'
import { Bubble } from '../../features/support/Bubble'
import { refreshSupportUnread } from '../../features/support/unread'
import '../../features/admin/admin.css'
import '../../features/support/support.css'

const POLL_MS = 10_000
const CHANNELS: SupportChannel[] = ['web', 'telegram']
const STATUS_TONE: Record<TicketStatus, PillTone> = { open: 'danger', pending: 'warning', resolved: 'success', closed: 'neutral' }

function readFilters(sp: URLSearchParams): SupportTicketFilters {
  const status = sp.get('status') as TicketStatus
  const channel = sp.get('channel') as SupportChannel
  return {
    status: TICKET_STATUSES.includes(status) ? status : undefined,
    channel: CHANNELS.includes(channel) ? channel : undefined,
    q: sp.get('q')?.trim() || undefined,
  }
}

export default function AdminSupport() {
  const p = useAdminDict()
  const id = useParams()['*'] || null
  const [sp, setSp] = useSearchParams()
  const filters = readFilters(sp)
  const key = sp.toString()
  const list = useAsync(() => supportAdminApi.tickets(filters), [key])
  usePoll(list.refresh, POLL_MS)

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp)
    if (v) next.set(k, v)
    else next.delete(k)
    setSp(next, { replace: true })
  }
  const [q, setQ] = useState(sp.get('q') ?? '')
  useEffect(() => {
    if (q.trim() === (sp.get('q') ?? '')) return
    const t = setTimeout(() => set('q', q.trim()), 300)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = !!(filters.status || filters.channel || filters.q)
  const reset = () => {
    setQ('')
    setSp(new URLSearchParams(), { replace: true })
  }
  /** A ticket changed in the thread: show it in the list without waiting for the poll. */
  const patchItem = (t: SupportTicket) => list.mutate((page) => ({ ...page, items: page.items.map((x) => (x.id === t.id ? t : x)) }))
  const query = key ? `?${key}` : ''

  return (
    <>
      <Head title={p.support.title} noindex />
      <div className="sp-page-head" data-has-ticket={id ? true : undefined}>
        <PageHead title={p.support.title} lead={p.support.lead} />
      </div>
      <div className="sp-inbox" data-has-ticket={id ? true : undefined}>
        <aside className="sp-list card" aria-label={p.support.listLabel}>
          <form className="sp-filters" role="search" onSubmit={(e) => (e.preventDefault(), set('q', q.trim()))}>
            <Field label={p.support.search} className="sp-filter-search">
              <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
            </Field>
            <Field label={p.support.status}>
              <Select value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)}>
                <option value="">{p.support.active}</option>
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {p.support.statuses[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={p.support.channel}>
              <Select value={filters.channel ?? ''} onChange={(e) => set('channel', e.target.value)}>
                <option value="">{p.support.any}</option>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {p.support.channels[c]}
                  </option>
                ))}
              </Select>
            </Field>
          </form>
          <TicketList p={p} res={list} current={id} query={query} filtered={filtered} onReset={reset} />
        </aside>
        <section className="sp-thread card" aria-label={p.support.threadLabel}>
          {id ? (
            <Thread key={id} id={id} p={p} query={query} onTicket={patchItem} />
          ) : (
            <EmptyState icon={<Inbox size={18} />} title={p.support.pickTitle} text={p.support.pickText} />
          )}
        </section>
      </div>
    </>
  )
}

function TicketList({
  p,
  res,
  current,
  query,
  filtered,
  onReset,
}: {
  p: AdminDict
  res: AsyncState<Paginated<SupportTicket>>
  current: string | null
  query: string
  filtered: boolean
  onReset: () => void
}) {
  const locale = useLocale()
  if (res.error && !res.data) return <LoadError text={res.error.message} onRetry={res.reload} className="sp-list-state" />
  if (!res.data)
    return (
      <DelayedReveal className="sp-list-state adm-skeleton-rows">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height="3rem" />
        ))}
      </DelayedReveal>
    )
  if (!res.data.items.length)
    return (
      <EmptyState
        className="sp-list-state"
        icon={<MessageSquareOff size={18} />}
        title={p.support.emptyTitle}
        text={filtered ? p.support.emptyFiltered : p.support.emptyText}
        action={
          filtered && (
            <Button variant="soft" onClick={onReset}>
              {p.support.reset}
            </Button>
          )
        }
      />
    )
  return (
    <ul className="sp-tickets" role="list" data-stale={res.loading || undefined}>
      {res.data.items.map((t) => {
        const ChannelIcon = t.channel === 'telegram' ? TelegramIcon : Globe
        const preview = t.preview || (t.preview_has_image ? p.support.photo : '')
        return (
          <li key={t.id}>
            <LocalLink to={`/admin/support/${t.id}${query}`} className="sp-ticket" aria-current={current === t.id ? 'page' : undefined}>
              <span className="sp-ticket-top">
                <ChannelIcon size={14} aria-label={p.support.channels[t.channel]} className="sp-channel" />
                <strong className="sp-ticket-name">{t.contact_name}</strong>
                <span className="sp-ticket-num">#{t.number}</span>
                {t.unread_count > 0 && <span className="sp-dot" role="img" aria-label={p.support.unread} />}
              </span>
              <span className="sp-ticket-preview">
                {t.preview_direction === 'out' && <span className="t-muted">{p.support.you}</span>}
                {preview}
              </span>
              <span className="sp-ticket-meta">
                <Pill tone={STATUS_TONE[t.status]}>{p.support.statuses[t.status]}</Pill>
                {t.waiting_since && <span className="sp-waiting">{fmt(p.support.waiting, { time: formatRelative(t.waiting_since, locale) })}</span>}
              </span>
            </LocalLink>
          </li>
        )
      })}
    </ul>
  )
}

function Thread({ id, p, query, onTicket }: { id: string; p: AdminDict; query: string; onTicket: (t: SupportTicket) => void }) {
  const t = useT()
  const locale = useLocale()
  const toast = useToast()
  const res = useAsync(() => supportAdminApi.ticket(id), [id])
  const [note, setNote] = useState(false)
  const logRef = useRef<HTMLOListElement>(null)
  const d = res.data

  const markRead = useCallback(
    (detail: SupportTicketDetail) => {
      if (!detail.ticket.unread_count) return
      // Refetch after marking read rather than patch the snapshot: a poll or another
      // staff member may have changed the status or assignee meanwhile.
      supportAdminApi
        .read(id)
        .then(() => supportAdminApi.ticket(id))
        .then((fresh) => {
          res.mutate(() => fresh)
          onTicket(fresh.ticket)
          refreshSupportUnread()
        }, () => {})
    },
    [id], // eslint-disable-line react-hooks/exhaustive-deps
  )
  useEffect(() => {
    if (d) markRead(d)
  }, [d?.ticket.unread_count]) // eslint-disable-line react-hooks/exhaustive-deps
  usePoll(res.refresh, POLL_MS)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [d?.messages.length])

  const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : t.errors.unknown, { tone: 'error' })
  const update = async (body: { status?: TicketStatus; assignee_id?: string | null }, done: string) => {
    try {
      const ticket = await supportAdminApi.update(id, body)
      res.mutate((x) => ({ ...x, ticket }))
      onTicket(ticket)
      toast(done, { tone: 'success' })
    } catch (e) {
      fail(e)
    }
  }
  const send = async (body: string, image: File | null) => {
    try {
      const m = await supportAdminApi.post(id, body, { note, image })
      const fresh = await supportAdminApi.ticket(id).catch(() => null)
      res.mutate((x) => fresh ?? { ...x, messages: [...x.messages, m] })
      if (fresh) onTicket(fresh.ticket)
      return true
    } catch (e) {
      fail(e)
      return false
    }
  }

  if (res.error && !d)
    return (
      <div className="sp-thread-state">
        <BackLink p={p} query={query} />
        {res.error.status === 404 ? (
          <EmptyState icon={<Inbox size={18} />} title={p.support.notFound} text={p.support.notFoundText} />
        ) : (
          <LoadError text={res.error.message} onRetry={res.reload} />
        )}
      </div>
    )
  if (!d)
    return (
      <DelayedReveal className="sp-thread-state adm-skeleton-rows">
        <Skeleton width="12rem" height="1.5rem" />
        <Skeleton height="4rem" />
        <Skeleton height="4rem" width="70%" />
      </DelayedReveal>
    )

  const { ticket, contact } = d
  const closed = ticket.status === 'closed'
  return (
    <div className="sp-thread-body">
      <header className="sp-thread-head">
        <BackLink p={p} query={query} />
        <div className="sp-thread-title">
          <h2>
            #{ticket.number} {ticket.contact_name}
          </h2>
          <Pill tone={ticket.channel === 'telegram' ? 'brand' : 'neutral'}>{p.support.channels[ticket.channel]}</Pill>
        </div>
        <div className="sp-thread-controls">
          <Field label={p.support.status}>
            <Select
              value={ticket.status}
              onChange={(e) => {
                const status = e.target.value as TicketStatus
                void update({ status }, fmt(p.support.statusChanged, { status: p.support.statuses[status] }))
              }}
            >
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {p.support.statuses[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={p.support.assignee}>
            <Select
              value={ticket.assignee_id ?? ''}
              onChange={(e) => {
                const assignee_id = e.target.value || null
                const name = d.assignees.find((a) => a.id === assignee_id)?.username ?? p.support.nobody
                void update({ assignee_id }, fmt(p.support.assigned, { name }))
              }}
            >
              <option value="">{p.support.nobody}</option>
              {d.assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  @{a.username}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </header>

      <ContactCard d={d} p={p} />

      <ol className="sp-log" ref={logRef} role="log" aria-label={p.support.threadLabel} tabIndex={0}>
        {d.messages.map((m) => (
          <StaffBubble key={m.id} m={m} p={p} />
        ))}
      </ol>

      {closed && !note && <p className="sp-closed-hint">{p.support.closedHint}</p>}
      <Composer
        tone={note ? 'note' : undefined}
        labels={{
          label: p.support.composerLabel,
          placeholder: note ? p.support.notePlaceholder : p.support.replyPlaceholder,
          send: note ? p.support.addNote : p.support.send,
          attach: p.support.attach,
          removeImage: p.support.removeImage,
          hint: note ? p.support.noteHint : p.support.sendHint,
        }}
        disabled={closed && !note}
        onSend={send}
        extra={<Switch label={p.support.note} checked={note} onChange={setNote} />}
      />
      {contact.blocked_at && (
        <p className="sp-blocked" role="status">
          {fmt(p.support.blocked, { date: formatDateTime(contact.blocked_at, locale) })}
        </p>
      )}
    </div>
  )
}

function StaffBubble({ m, p }: { m: StaffMessage; p: AdminDict }) {
  const who = { in: p.support.customer, note: `${p.support.note} @${m.author_username ?? ''}`, out: `@${m.author_username ?? p.support.staff}` }[m.direction]
  return (
    <Bubble
      side={m.direction === 'in' ? 'them' : 'me'}
      note={m.direction === 'note'}
      who={who}
      at={m.created_at}
      body={m.body}
      imageUrl={m.image_url}
      imageAlt={p.support.imageAlt}
      edited={m.edited_at ? p.support.edited : undefined}
    >
      {m.delivery === 'failed' && (
        <Pill tone="danger" title={m.delivery_error ?? undefined}>
          {p.support.failed}
        </Pill>
      )}
      {/* A Telegram reply waits for the bot's report; the 10 s poll picks the outcome up. */}
      {m.direction === 'out' && m.delivery === null && <Pill>{p.support.sending}</Pill>}
    </Bubble>
  )
}

function ContactCard({ d, p }: { d: SupportTicketDetail; p: AdminDict }) {
  const c = d.contact
  const locale = useLocale()
  return (
    <dl className="sp-contact">
      {c.user ? (
        <>
          <div>
            <dt>{p.support.email}</dt>
            <dd>{c.user.email}</dd>
          </div>
          <div>
            <dt>{p.support.tier}</dt>
            <dd>
              <TierBadge subscription={c.user.tier ? { tier: c.user.tier, effective_tier: c.user.tier, expires_at: null, is_expired: false } : null} />
            </dd>
          </div>
          <div>
            <dt className="sr-only">{p.support.openUser}</dt>
            <dd>
              <LocalLink to={`/admin/users/${c.user.id}`} className="link">
                {p.support.openUser}
              </LocalLink>
            </dd>
          </div>
        </>
      ) : (
        <>
          <div>
            <dt>{p.support.tgUser}</dt>
            <dd>
              {c.tg_username ? (
                <a href={`https://t.me/${c.tg_username}`} target="_blank" rel="noopener noreferrer" className="link">
                  @{c.tg_username}
                </a>
              ) : (
                <span className="t-muted">{p.support.noUsername}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{p.support.tgId}</dt>
            <dd className="adm-mono">{c.tg_user_id}</dd>
          </div>
          {c.other_tickets.length > 0 && (
            <div>
              <dt>{p.support.otherTickets}</dt>
              <dd className="sp-other">
                {c.other_tickets.map((o) => (
                  <LocalLink key={o.id} to={`/admin/support/${o.id}`} className="link" title={formatDateTime(o.created_at, locale)}>
                    #{o.number} {p.support.statuses[o.status]}
                  </LocalLink>
                ))}
              </dd>
            </div>
          )}
        </>
      )}
    </dl>
  )
}

function BackLink({ p, query }: { p: AdminDict; query: string }) {
  return (
    <LocalLink to={`/admin/support${query}`} className="sp-back link">
      <ArrowLeft size={14} aria-hidden />
      {p.support.back}
    </LocalLink>
  )
}
