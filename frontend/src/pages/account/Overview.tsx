import { useState } from 'react'
import { Check, Download, Send } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { appApi, authApi } from '../../api/endpoints'
import { TIERS, type Subscription, type Tier, type TierInfo, type User } from '../../api/types'
import { GET_ACCESS_URL, TELEGRAM_CHANNEL } from '../../config'
import { LocalLink, fmt, useLocale, useT } from '../../i18n'
import { formatBytes, formatDate } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { useLatestRelease } from '../../lib/useLatestRelease'
import { Button, ButtonLink, DelayedReveal, EmptyState, LoadError, Note, PageHead, Pill, Section, Skeleton, TierBadge } from '../../ui'
import { fill } from '../../features/auth/parts'
import { useAccountDict } from '../../features/account/dict'

/** The tier whose features work now: an expired plan falls back to Basic, no plan is null. */
const workingTier = (sub: Subscription | null): Tier | null => (sub ? (sub.is_expired ? 'basic' : sub.effective_tier) : null)

function Lines({ n = 3 }: { n?: number }) {
  return (
    <DelayedReveal className="skeleton-lines">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} width={`${90 - i * 18}%`} height="0.875rem" />
      ))}
    </DelayedReveal>
  )
}

function TierFeatures({ tiers, current }: { tiers: TierInfo[]; current: Tier }) {
  const a = useAccountDict()
  const t = useT()
  const byId = (id: Tier) => tiers.find((x) => x.id === id)
  const cur = byId(current)
  const next = byId(TIERS[TIERS.indexOf(current) + 1])
  if (!cur) return null
  // A feature with a monthly limit on any tier shows its limit, "unlimited" included.
  const limited = new Set(tiers.flatMap((x) => x.features.filter((f) => f.monthly_limit !== null).map((f) => f.id)))
  const limitText = (n: number | null) => (n === null ? a.features.unlimited : fmt(a.features.perMonth, { count: n }))
  const extras = next
    ? next.features.filter((f) => {
        const mine = cur.features.find((m) => m.id === f.id)
        return f.allowed && (!mine?.allowed || mine.monthly_limit !== f.monthly_limit)
      })
    : []
  return (
    <>
      <div>
        <h3 className="acc-subhead">{a.overview.includes}</h3>
        <ul className="feature-list">
          {cur.features
            .filter((f) => f.allowed)
            .map((f) => (
              <li key={f.id}>
                <Check size={15} aria-hidden />
                <span>{t.feature[f.id]}</span>
                {limited.has(f.id) && <span className="feature-limit num">{limitText(f.monthly_limit)}</span>}
              </li>
            ))}
        </ul>
      </div>
      {next && extras.length > 0 && (
        <p className="tier-next">
          <strong>{fmt(a.overview.nextExtras, { tier: t.tier[next.id] })}</strong>{' '}
          {extras
            .map((f) => {
              const mine = cur.features.find((m) => m.id === f.id)
              return mine?.allowed ? `${t.feature[f.id].toLowerCase()} ${limitText(f.monthly_limit)}` : t.feature[f.id].toLowerCase()
            })
            .join(', ')}
          .
        </p>
      )}
    </>
  )
}

function PlanCard({ user }: { user: User }) {
  const a = useAccountDict()
  const t = useT()
  const locale = useLocale()
  const tiers = useAsync(() => appApi.tiers(), [])
  const sub = user.subscription
  const tier = workingTier(sub)
  const status = !sub
    ? null
    : sub.is_expired
      ? fmt(a.overview.expiredOn, { date: formatDate(sub.expires_at!, locale) })
      : sub.expires_at
        ? fmt(a.overview.activeUntil, { date: formatDate(sub.expires_at, locale) })
        : a.overview.activeForever

  return (
    <Section title={a.overview.tierTitle} aside={<TierBadge subscription={sub} />}>
      {sub ? (
        <div>
          <p className="tier-name" data-tier={sub.tier}>
            {t.tier[sub.tier]}
          </p>
          <p className="tier-meta" data-tone={sub.is_expired ? 'danger' : undefined}>
            {status}
            {sub.started_at && !sub.is_expired && <> · {fmt(a.overview.startedOn, { date: formatDate(sub.started_at, locale) })}</>}
          </p>
        </div>
      ) : (
        <p className="section-lead">{a.overview.noTier}</p>
      )}
      {tier && (tiers.loading ? <Lines /> : tiers.data ? <TierFeatures tiers={tiers.data} current={tier} /> : <p className="def-sub">{a.overview.tiersFailed}</p>)}
      <div className="acc-actions">
        {!sub && (
          <ButtonLink href={GET_ACCESS_URL} variant="primary" size="lg">
            <Send size={15} aria-hidden />
            {t.actions.getAccess}
          </ButtonLink>
        )}
        {sub?.is_expired && (
          <ButtonLink href={GET_ACCESS_URL} variant="soft">
            {a.overview.renew}
          </ButtonLink>
        )}
        <LocalLink to="/pricing" className="link t-s">
          {a.overview.compare}
        </LocalLink>
      </div>
    </Section>
  )
}

function DownloadCard({ primary, beta }: { primary: boolean; beta: boolean }) {
  const a = useAccountDict()
  const locale = useLocale()
  const latest = useLatestRelease()
  const r = latest.data
  return (
    <Section title={a.overview.downloadTitle} lead={beta ? a.overview.betaHint : undefined}>
      {latest.loading ? (
        <Lines n={2} />
      ) : r ? (
        <>
          <div>
            <p className="release-version num">
              {fmt(a.overview.version, { version: r.version })}
              {r.channel === 'beta' && <Pill tone="warning">{a.overview.beta}</Pill>}
            </p>
            <p className="release-meta num">
              <span>{formatBytes(r.file_size, locale)}</span>
              <span>{fmt(a.overview.released, { date: formatDate(r.published_at, locale) })}</span>
            </p>
          </div>
          <div className="acc-actions">
            <ButtonLink href={r.url} variant={primary ? 'primary' : 'soft'} size="lg" download>
              <Download size={16} aria-hidden />
              {a.overview.download}
            </ButtonLink>
            <LocalLink to="/changelog" className="link t-s">
              {a.overview.changelog}
            </LocalLink>
          </div>
        </>
      ) : latest.error?.status === 404 ? (
        <EmptyState
          className="acc-empty"
          title={a.overview.noRelease}
          text={a.overview.noReleaseText}
          action={
            <ButtonLink href={TELEGRAM_CHANNEL} variant="soft">
              {a.overview.openChannel}
            </ButtonLink>
          }
        />
      ) : (
        <LoadError text={latest.error?.message ?? a.overview.releaseFailed} onRetry={latest.reload} className="acc-empty" />
      )}
    </Section>
  )
}

function VerifyBanner({ email }: { email: string }) {
  const a = useAccountDict()
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle')
  const strong = <strong>{email}</strong>
  if (state === 'sent') return <Note tone="success">{fill(a.overview.resent, { email: strong })}</Note>
  return (
    <Note tone="warning">
      <span>{fill(a.overview.unverified, { email: strong })}</span>
      <Button
        variant="soft"
        loading={state === 'busy'}
        onClick={() => {
          setState('busy')
          authApi.resendVerification(email).finally(() => setState('sent'))
        }}
      >
        {a.overview.resend}
      </Button>
    </Note>
  )
}

export default function AccountOverview() {
  const a = useAccountDict()
  const locale = useLocale()
  const { user } = useAuth()
  if (!user) return null
  return (
    <>
      <PageHead title={a.overview.title} lead={user.created_at ? fmt(a.memberSince, { date: formatDate(user.created_at, locale) }) : undefined} />
      <div className="acc-grid">
        {!user.is_verified && <VerifyBanner email={user.email} />}
        <PlanCard user={user} />
        <DownloadCard primary={!!user.subscription} beta={!!user.is_beta_tester} />
      </div>
    </>
  )
}
