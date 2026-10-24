import { useState, type KeyboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bug, SearchX } from 'lucide-react'
import { crashApi } from '../../api/endpoints'
import { CRASH_KINDS, CRASH_STATUSES, type CrashFilters, type CrashKind, type CrashStatus } from '../../api/types'
import { LocalLink, useLocale, useLp } from '../../i18n'
import { formatDateTime, formatNumber, formatRelative } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { Button, DelayedReveal, EmptyState, Field, Input, LoadError, PageHead, Pagination, Select, Skeleton, Table } from '../../ui'
import { CrashStatusPill } from '../../features/admin/crash'
import { useAdminDict } from '../../features/admin/useAdmin'
import '../../features/admin/admin.css'

const PAGE_SIZE = 25
const FILTER_KEYS = ['status', 'kind', 'error_code', 'version', 'from', 'to'] as const
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** URL query -> API filters. Unknown values are dropped, so a hand-edited URL cannot 422. */
function readFilters(sp: URLSearchParams): CrashFilters {
  const status = sp.get('status') as CrashStatus
  const kind = sp.get('kind') as CrashKind
  const day = (k: string) => (DAY_RE.test(sp.get(k) ?? '') ? sp.get(k)! : undefined)
  return {
    status: CRASH_STATUSES.includes(status) ? status : undefined,
    kind: CRASH_KINDS.includes(kind) ? kind : undefined,
    error_code: sp.get('error_code')?.trim().slice(0, 32) || undefined,
    version: sp.get('version')?.trim().slice(0, 64) || undefined,
    from: day('from'),
    to: day('to'),
    sort: sp.get('sort') === 'count' ? 'count' : 'last_seen',
    page: Math.max(1, Number(sp.get('page')) || 1),
    page_size: PAGE_SIZE,
  }
}

export default function AdminCrashes() {
  const p = useAdminDict()
  const c = p.crashes
  const locale = useLocale()
  const lp = useLp()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const filters = readFilters(sp)
  const list = useAsync(() => crashApi.groups(filters), [sp.toString()])

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp)
    if (v) next.set(k, v)
    else next.delete(k)
    next.delete('page')
    setSp(next, { replace: true })
  }
  // Free-text filters land in the URL on blur or Enter, not on every keystroke.
  const [code, setCode] = useState(sp.get('error_code') ?? '')
  const [version, setVersion] = useState(sp.get('version') ?? '')
  const commitText = () => {
    const next = new URLSearchParams(sp)
    for (const [k, v] of [['error_code', code.trim()], ['version', version.trim()]] as const) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (next.toString() === sp.toString()) return
    next.delete('page')
    setSp(next, { replace: true })
  }

  // The form has several text inputs and no submit button, so Enter does not submit it by itself.
  const commitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && (e.preventDefault(), commitText())

  const anyFilter = FILTER_KEYS.some((k) => sp.has(k))
  const reset = () => {
    setCode('')
    setVersion('')
    setSp(new URLSearchParams(), { replace: true })
  }
  const data = list.data

  return (
    <>
      <PageHead title={c.title} lead={c.lead} />

      <form className="adm-filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <Field label={c.status}>
          <Select value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">{c.any}</option>
            {CRASH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {c.statuses[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={c.kind}>
          <Select value={filters.kind ?? ''} onChange={(e) => set('kind', e.target.value)}>
            <option value="">{c.any}</option>
            {CRASH_KINDS.map((k) => (
              <option key={k} value={k}>
                {c.kinds[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={c.errorCode}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} onBlur={commitText} onKeyDown={commitOnEnter} placeholder="WD-CORE-001" maxLength={32} spellCheck={false} />
        </Field>
        <Field label={c.version}>
          <Input value={version} onChange={(e) => setVersion(e.target.value)} onBlur={commitText} onKeyDown={commitOnEnter} placeholder="0.8.1" maxLength={64} spellCheck={false} />
        </Field>
        <Field label={c.from}>
          <Input type="date" value={filters.from ?? ''} max={filters.to} onChange={(e) => set('from', e.target.value)} />
        </Field>
        <Field label={c.to}>
          <Input type="date" value={filters.to ?? ''} min={filters.from} onChange={(e) => set('to', e.target.value)} />
        </Field>
        <Field label={c.sort}>
          <Select value={filters.sort} onChange={(e) => set('sort', e.target.value === 'count' ? 'count' : '')}>
            <option value="last_seen">{c.sortLastSeen}</option>
            <option value="count">{c.sortCount}</option>
          </Select>
        </Field>
        {anyFilter && (
          <Button variant="ghost" className="adm-filter-reset" onClick={reset}>
            {c.reset}
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
          icon={anyFilter ? <SearchX size={18} /> : <Bug size={18} />}
          title={anyFilter ? c.filteredTitle : c.emptyTitle}
          text={anyFilter ? c.filteredText : c.emptyText}
          action={
            anyFilter && (
              <Button variant="soft" onClick={reset}>
                {c.reset}
              </Button>
            )
          }
        />
      ) : (
        <div className="adm-users" data-stale={list.loading || undefined}>
          <Table label={c.tableLabel} className="adm-crashes-table">
            <thead>
              <tr>
                <th scope="col">{c.status}</th>
                <th scope="col">{c.colCrash}</th>
                <th scope="col">{c.kind}</th>
                <th scope="col" className="num">
                  {c.colReports}
                </th>
                <th scope="col">{c.colVersion}</th>
                <th scope="col" className="num">
                  {c.colLastSeen}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((g) => (
                <tr key={g.id} className="table-row-link" onClick={() => navigate(lp(`/admin/crashes/${g.id}`))}>
                  <td className="adm-nowrap">
                    <CrashStatusPill status={g.status} />
                  </td>
                  <td className="adm-crash-cell">
                    <LocalLink to={`/admin/crashes/${g.id}`} className="adm-user-link" onClick={(e) => e.stopPropagation()}>
                      {g.title}
                    </LocalLink>
                    <span className="adm-sub adm-mono">{g.error_code}</span>
                  </td>
                  <td className="t-muted">{c.kinds[g.kind]}</td>
                  <td className="num">{formatNumber(g.report_count, locale)}</td>
                  <td className="adm-tab">{g.last_app_version}</td>
                  <td className="num t-muted adm-nowrap" title={formatDateTime(g.last_seen, locale)}>
                    {formatRelative(g.last_seen, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
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
