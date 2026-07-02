// Мелкие переиспользуемые куски UI админки: форматирование даты и бейджи.

export function fmtDate(s: string | null | undefined): string {
  return s ? new Date(s).toLocaleString() : '—'
}

// Разворачивает JSON-детали записи аудита в короткую строку "key: value".
export function formatDetails(details: Record<string, unknown>): string {
  const entries = Object.entries(details)
  if (entries.length === 0) return '—'
  return entries.map(([k, v]) => `${k}: ${v}`).join(', ')
}

const ROLE_BADGE: Record<string, string> = {
  admin: 'badge-admin',
  moderator: 'badge-moderator',
  support: 'badge-support',
  user: 'badge-user',
}

export function RoleBadge({ role }: { role: string }) {
  return <span className={`badge ${ROLE_BADGE[role] ?? 'badge-user'}`}>{role}</span>
}

const TIER_BADGE: Record<string, string> = {
  pro: 'badge-pro',
  plus: 'badge-plus',
  basic: 'badge-basic',
}

export function TierBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return <span className="text-sm">—</span>
  return <span className={`badge ${TIER_BADGE[tier] ?? 'badge-basic'}`}>{tier}</span>
}

export function YesNo({ value }: { value: boolean }) {
  return (
    <span className={`badge ${value ? 'badge-verified' : 'badge-muted'}`}>
      {value ? 'yes' : 'no'}
    </span>
  )
}

interface PaginationProps {
  page: number
  total: number
  pageSize: number
  onChange: (page: number) => void
}

export function Pagination({ page, total, pageSize, onChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="pagination">
      <button
        className="btn btn-ghost"
        style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        ‹ Prev
      </button>
      <span>Page {page} of {totalPages} · {total} total</span>
      <button
        className="btn btn-ghost"
        style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next ›
      </button>
    </div>
  )
}
