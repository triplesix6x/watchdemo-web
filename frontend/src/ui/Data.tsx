// Data display: Pill and the tier/role badges, Table, Pagination, Stat.
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fmt, useT } from '../i18n'
import type { Role, Subscription } from '../api/types'
import { Button } from './Button'

export type PillTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 't' | 'ct'

export function Pill({ tone = 'neutral', children, className = '', title }: { tone?: PillTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={`pill${tone === 'neutral' ? '' : ` pill-${tone}`} ${className}`} title={title}>
      {children}
    </span>
  )
}

const TIER_TONE = { basic: 'neutral', plus: 'success', pro: 'brand' } as const

/** Effective tier of a subscription; "No plan" when there is none or it expired. */
export function TierBadge({ subscription }: { subscription: Subscription | null | undefined }) {
  const t = useT()
  if (!subscription) return <Pill>{t.tier.none}</Pill>
  const tier = subscription.is_expired ? null : subscription.effective_tier
  if (!tier) return <Pill tone="danger">{`${t.tier[subscription.tier]} · ${t.tier.expired}`}</Pill>
  return <Pill tone={TIER_TONE[tier]}>{t.tier[tier]}</Pill>
}

const ROLE_TONE: Record<Role, PillTone> = { user: 'neutral', support: 'success', moderator: 'warning', admin: 'brand' }

export function RoleBadge({ role }: { role: Role }) {
  const t = useT()
  return <Pill tone={ROLE_TONE[role]}>{t.role[role]}</Pill>
}

/** Card with a horizontally scrollable table. Children are <thead>/<tbody>; cells get
 *  the app's styling. Put className="num" on numeric cells (right-aligned, tabular). */
export function Table({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`card table-wrap ${className}`}>
      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">{label}</caption>
          {children}
        </table>
      </div>
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPage, className = '' }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; className?: string }) {
  const t = useT()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav className={`pagination ${className}`} aria-label={t.a11y.pagination}>
      <span className="num">{fmt(t.pagination.range, { from, to, total })}</span>
      <span className="row">
        <Button variant="ghost" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          <ChevronLeft size={16} aria-hidden />
          {t.pagination.prev}
        </Button>
        <span className="num">
          {fmt(t.pagination.page, { page, pages })}
        </span>
        <Button variant="ghost" onClick={() => onPage(page + 1)} disabled={page >= pages}>
          {t.pagination.next}
          <ChevronRight size={16} aria-hidden />
        </Button>
      </span>
    </nav>
  )
}

/** Number tile for dashboards. `hint` is a delta or context; tone colours a delta. */
export function Stat({ label, value, hint, tone, className = '' }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'up' | 'down'; className?: string }) {
  return (
    <div className={`card stat ${className}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && (
        <span className="stat-hint" data-tone={tone}>
          {hint}
        </span>
      )}
    </div>
  )
}
