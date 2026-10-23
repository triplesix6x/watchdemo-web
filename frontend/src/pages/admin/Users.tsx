import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { adminApi } from '../../api/endpoints'
import type { AdminUserFilters, AdminUserListItem, Role, Tier } from '../../api/types'
import { LocalLink, useLocale, useLp, useT } from '../../i18n'
import { formatDate } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { Button, DelayedReveal, EmptyState, Field, Input, LoadError, PageHead, Pagination, Pill, RoleBadge, Select, Skeleton, Table, TierBadge } from '../../ui'
import { useAdminDict } from '../../features/admin/useAdmin'
import '../../features/admin/admin.css'

const PAGE_SIZE = 25
const ROLES: Role[] = ['user', 'support', 'moderator', 'admin']
const TIERS: (Tier | 'none')[] = ['none', 'basic', 'plus', 'pro']
const FILTER_KEYS = ['q', 'role', 'verified', 'active', 'tier'] as const

/** URL query -> API filters. Unknown values are dropped, so a hand-edited URL cannot 422. */
function readFilters(sp: URLSearchParams): AdminUserFilters {
  const bool = (k: string) => (sp.get(k) === 'true' ? true : sp.get(k) === 'false' ? false : undefined)
  const role = sp.get('role') as Role
  const tier = sp.get('tier') as Tier | 'none'
  return {
    q: sp.get('q')?.trim() || undefined,
    role: ROLES.includes(role) ? role : undefined,
    verified: bool('verified'),
    active: bool('active'),
    tier: TIERS.includes(tier) ? tier : undefined,
    page: Math.max(1, Number(sp.get('page')) || 1),
    page_size: PAGE_SIZE,
  }
}

export default function AdminUsers() {
  const p = useAdminDict()
  const t = useT()
  const locale = useLocale()
  const lp = useLp()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const filters = readFilters(sp)
  const key = sp.toString()
  const list = useAsync(() => adminApi.users(filters), [key])

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp)
    if (v) next.set(k, v)
    else next.delete(k)
    next.delete('page')
    setSp(next, { replace: true })
  }

  // Search types into local state and lands in the URL after a pause.
  const [q, setQ] = useState(sp.get('q') ?? '')
  useEffect(() => {
    if (q.trim() === (sp.get('q') ?? '')) return
    const id = setTimeout(() => set('q', q.trim()), 300)
    return () => clearTimeout(id)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const anyFilter = FILTER_KEYS.some((k) => sp.has(k))
  const reset = () => {
    setQ('')
    setSp(new URLSearchParams(), { replace: true })
  }
  const open = (u: AdminUserListItem) => navigate(lp(`/admin/users/${u.id}`))
  const data = list.data

  return (
    <>
      <PageHead title={p.users.title} lead={p.users.lead} />

      <form className="adm-filters" role="search" onSubmit={(e) => (e.preventDefault(), set('q', q.trim()))}>
        <Field label={p.users.search} className="adm-filter-search">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field label={p.users.role}>
          <Select value={filters.role ?? ''} onChange={(e) => set('role', e.target.value)}>
            <option value="">{p.users.any}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t.role[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={p.users.verified}>
          <Select value={sp.get('verified') ?? ''} onChange={(e) => set('verified', e.target.value)}>
            <option value="">{p.users.any}</option>
            <option value="true">{p.users.yes}</option>
            <option value="false">{p.users.no}</option>
          </Select>
        </Field>
        <Field label={p.users.active}>
          <Select value={sp.get('active') ?? ''} onChange={(e) => set('active', e.target.value)}>
            <option value="">{p.users.any}</option>
            <option value="true">{p.users.activeYes}</option>
            <option value="false">{p.users.activeNo}</option>
          </Select>
        </Field>
        <Field label={p.users.tier}>
          <Select value={filters.tier ?? ''} onChange={(e) => set('tier', e.target.value)}>
            <option value="">{p.users.any}</option>
            {TIERS.map((x) => (
              <option key={x} value={x}>
                {x === 'none' ? t.tier.none : t.tier[x]}
              </option>
            ))}
          </Select>
        </Field>
        {anyFilter && (
          <Button variant="ghost" className="adm-filter-reset" onClick={reset}>
            {p.users.reset}
          </Button>
        )}
      </form>

      {list.error && !data ? (
        <LoadError text={list.error.message} onRetry={list.reload} />
      ) : !data ? (
        <DelayedReveal className="card adm-skeleton-rows">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} height="1.25rem" />
          ))}
        </DelayedReveal>
      ) : data.items.length === 0 ? (
        <EmptyState
          className="card"
          icon={<SearchX size={18} />}
          title={p.users.emptyTitle}
          text={p.users.emptyText}
          action={
            anyFilter && (
              <Button variant="soft" onClick={reset}>
                {p.users.reset}
              </Button>
            )
          }
        />
      ) : (
        <div className="adm-users" data-stale={list.loading || undefined}>
          <Table label={p.users.tableLabel} className="adm-users-table">
            <thead>
              <tr>
                <th scope="col">{p.users.colUser}</th>
                <th scope="col">{p.users.role}</th>
                <th scope="col">{p.users.tier}</th>
                <th scope="col">{p.users.verified}</th>
                <th scope="col">{p.users.active}</th>
                <th scope="col">{p.users.colBeta}</th>
                <th scope="col" className="num">
                  {p.users.colJoined}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id} className="table-row-link" onClick={() => open(u)}>
                  <td>
                    <LocalLink to={`/admin/users/${u.id}`} className="adm-user-link" onClick={(e) => e.stopPropagation()}>
                      @{u.username}
                    </LocalLink>
                    <span className="adm-sub">{u.email}</span>
                  </td>
                  <td>{u.role === 'user' ? <span className="t-muted">{t.role.user}</span> : <RoleBadge role={u.role} />}</td>
                  <td>
                    <TierBadge subscription={u.subscription} />
                  </td>
                  <td>{u.is_verified ? <span className="t-muted">{p.users.yes}</span> : <Pill tone="warning">{p.users.no}</Pill>}</td>
                  <td>{u.is_active ? <span className="t-muted">{p.users.activeYes}</span> : <Pill tone="danger">{p.users.activeNo}</Pill>}</td>
                  <td>{u.is_beta_tester ? <Pill tone="brand">{p.users.beta}</Pill> : <span className="t-muted">·</span>}</td>
                  <td className="num t-muted">{u.created_at ? formatDate(u.created_at, locale) : '·'}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          <ul className="adm-user-cards" aria-label={p.users.tableLabel}>
            {data.items.map((u) => (
              <li key={u.id}>
                <LocalLink to={`/admin/users/${u.id}`} className="card adm-user-card">
                  <span className="adm-user-card-top">
                    <strong>@{u.username}</strong>
                    <TierBadge subscription={u.subscription} />
                  </span>
                  <span className="adm-sub">{u.email}</span>
                  <span className="adm-user-card-tags">
                    {u.role !== 'user' && <RoleBadge role={u.role} />}
                    {!u.is_verified && <Pill tone="warning">{p.users.unverified}</Pill>}
                    {!u.is_active && <Pill tone="danger">{p.users.disabled}</Pill>}
                    {u.is_beta_tester && <Pill tone="brand">{p.users.beta}</Pill>}
                  </span>
                </LocalLink>
              </li>
            ))}
          </ul>

          <Pagination
            className="adm-pagination"
            page={data.page}
            pageSize={data.page_size}
            total={data.total}
            onPage={(n) => {
              const next = new URLSearchParams(sp)
              next.set('page', String(n))
              setSp(next)
            }}
          />
        </div>
      )}
    </>
  )
}
