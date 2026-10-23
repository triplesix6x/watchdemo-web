import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { adminApi } from '../../api/endpoints'
import type { AdminTimeseries } from '../../api/types'
import { useAuth } from '../../context/AuthContext'
import { LocalLink, fmt, useLocale, useT } from '../../i18n'
import { formatDate, formatNumber, formatRelative } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { Button, DelayedReveal, EmptyState, LoadError, PageHead, Section, Seg, Skeleton, Stat, TierBadge } from '../../ui'
import { can } from '../../features/admin/access'
import { SignupsChart, TierSplit } from '../../features/admin/charts'
import { useAdminAction, useAdminDict } from '../../features/admin/useAdmin'
import '../../features/admin/admin.css'

type Days = '30' | '90'
type Expiring = AdminTimeseries['expiring_soon'][number]

export default function AdminOverview() {
  const p = useAdminDict()
  const t = useT()
  const locale = useLocale()
  const { user } = useAuth()
  const [days, setDays] = useState<Days>('30')
  const stats = useAsync(() => adminApi.stats(), [])
  const series = useAsync(() => adminApi.timeseries(days === '90' ? 90 : 30), [days])
  const { run, busy } = useAdminAction()

  const expiring = series.data?.expiring_soon ?? []

  // The new date shows at once; a failed extension puts the old one back.
  const extend = async (row: Expiring) => {
    const setDate = (expires_at: string) =>
      series.mutate((d) => ({ ...d, expiring_soon: d.expiring_soon.map((x) => (x.user_id === row.user_id ? { ...x, expires_at } : x)) }))
    const guess = new Date(Math.max(Date.now(), Date.parse(row.expires_at)) + 30 * 86_400_000).toISOString()
    setDate(guess)
    const res = await run(`extend-${row.user_id}`, () => adminApi.extendSubscription(row.user_id, 30), (r) =>
      fmt(p.overview.extendedTo, { name: row.username, date: formatDate(r.expires_at ?? guess, locale) }),
    )
    setDate(res ? (res.expires_at ?? guess) : row.expires_at)
  }

  const s = stats.data
  const share = (v: number) => fmt(p.overview.stats.ofTotal, { pct: s?.total ? Math.round((v / s.total) * 100) : 0 })
  const tiles = s && [
    { label: p.overview.stats.total, value: s.total },
    { label: p.overview.stats.verified, value: s.verified, hint: share(s.verified) },
    { label: p.overview.stats.active, value: s.active, hint: share(s.active) },
    { label: p.overview.stats.paying, value: s.paying, hint: share(s.paying) },
    { label: p.overview.stats.signups7, value: s.signups_7d },
    { label: p.overview.stats.signups30, value: s.signups_30d },
  ]

  return (
    <>
      <PageHead title={p.overview.title} lead={p.overview.lead} />

      {stats.error ? (
        <LoadError text={stats.error.message} onRetry={stats.reload} />
      ) : (
        <div className="adm-tiles">
          {tiles
            ? tiles.map((x) => <Stat key={x.label} label={x.label} value={formatNumber(x.value, locale)} hint={x.hint} />)
            : Array.from({ length: 6 }, (_, i) => (
                <DelayedReveal key={i} className="card stat">
                  <Skeleton width="60%" height="0.75rem" />
                  <Skeleton width="40%" height="1.75rem" />
                </DelayedReveal>
              ))}
        </div>
      )}

      <div className="adm-overview-grid">
        <Section
          title={p.overview.signups}
          className="adm-section adm-span-2"
          aside={
            <Seg
              label={p.overview.range}
              value={days}
              onChange={setDays}
              items={[
                { value: '30', label: p.overview.days30 },
                { value: '90', label: p.overview.days90 },
              ]}
            />
          }
        >
          {series.error ? (
            <LoadError text={series.error.message} onRetry={series.reload} />
          ) : series.data ? (
            <SignupsChart points={series.data.signups} stale={series.loading} />
          ) : (
            <DelayedReveal>
              <Skeleton height="232px" radius="var(--r-lg)" />
            </DelayedReveal>
          )}
        </Section>

        <Section title={p.overview.tiers} className="adm-section">
          {series.data ? (
            <TierSplit tiers={series.data.tiers} />
          ) : (
            !series.error && (
              <DelayedReveal>
                <Skeleton height="8rem" radius="var(--r-lg)" />
              </DelayedReveal>
            )
          )}
        </Section>

        <Section title={p.overview.expiring} className="adm-section adm-span-3">
          {series.data && expiring.length === 0 && (
            <EmptyState
              icon={<CalendarClock size={18} />}
              title={p.overview.expiringEmpty}
              action={<LocalLink to="/admin/users" className="link">{t.shell.users}</LocalLink>}
            />
          )}
          {expiring.length > 0 && (
            <ul className="adm-list">
              {expiring.map((x) => (
                <li key={x.user_id} className="adm-list-row">
                  <LocalLink to={`/admin/users/${x.user_id}`} className="adm-list-main">
                    @{x.username}
                  </LocalLink>
                  <TierBadge subscription={{ tier: x.tier, effective_tier: x.tier, expires_at: x.expires_at, is_expired: false }} />
                  <span className="adm-list-meta num">
                    {formatDate(x.expires_at, locale)} · {formatRelative(x.expires_at, locale)}
                  </span>
                  {can(user?.role, 'moderate') && (
                    <Button variant="soft" loading={busy === `extend-${x.user_id}`} onClick={() => extend(x)}>
                      {p.overview.extend30}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  )
}
