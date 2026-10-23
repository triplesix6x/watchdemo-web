// The subscription card of a user's admin page: status, quick and custom extension, grant.
import { adminApi } from '../../api/endpoints'
import { TIERS, type AdminUserDetail, type GrantSubscriptionResponse, type Subscription, type Tier } from '../../api/types'
import { fmt, useLocale, useT } from '../../i18n'
import { formatDate } from '../../lib/format'
import { useForm } from '../../lib/useForm'
import { Button, Field, Input, Section, Select, TierBadge } from '../../ui'
import { useAdminAction, useAdminDict } from './useAdmin'

type Run = ReturnType<typeof useAdminAction>['run']

export const toSummary = (r: GrantSubscriptionResponse): Subscription => ({
  tier: r.tier,
  effective_tier: r.effective_tier,
  started_at: r.started_at,
  expires_at: r.expires_at,
  is_expired: r.is_expired,
})

export function SubscriptionCard({
  u,
  canEdit,
  busy,
  run,
  onChanged,
  onRevoke,
}: {
  u: AdminUserDetail
  canEdit: boolean
  busy: string | null
  run: Run
  onChanged: (s: Subscription) => void
  onRevoke: () => void
}) {
  const p = useAdminDict()
  const t = useT()
  const locale = useLocale()
  const s = u.subscription
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  const custom = useForm({ days: '' }, { days: (v) => (v === '' || isDays(v) ? null : p.user.extendHint) })
  const grantForm = useForm(
    { tier: 'plus', until: '' },
    { until: (v) => (v && v < tomorrow ? fmt(p.user.expiresOn, { date: formatDate(tomorrow, locale) }) : null) },
  )

  const extendable = !!s && s.tier !== 'basic' && !!s.expires_at
  const revokable = !!s && (s.tier !== 'basic' || !!s.expires_at)

  const extend = async (n: number, key = `extend-${n}`) => {
    const r = await run(key, () => adminApi.extendSubscription(u.id, n), (x) => fmt(p.user.extended, { date: formatDate(x.expires_at!, locale) }))
    if (r) {
      onChanged(toSummary(r))
      custom.reset()
    }
  }
  const grant = grantForm.onSubmit(async (v) => {
    const tier = v.tier as Tier
    const expires_at = v.until ? new Date(`${v.until}T23:59:59`).toISOString() : null
    const r = await run('grant', () => adminApi.grantSubscription({ user_id: u.id, tier, expires_at }), fmt(p.user.granted, { tier: t.tier[tier] }))
    if (r) {
      onChanged(toSummary(r))
      grantForm.reset()
    }
  })

  const status = !s
    ? p.user.noSub
    : s.is_expired && s.expires_at
      ? fmt(p.user.expiredOn, { date: formatDate(s.expires_at, locale) })
      : s.expires_at
        ? fmt(p.user.expiresOn, { date: formatDate(s.expires_at, locale) })
        : p.user.forever

  return (
    <Section
      title={p.user.subscription}
      className="adm-section"
      aside={
        canEdit &&
        revokable && (
          <Button variant="ghost" className="adm-danger-ghost" onClick={onRevoke} disabled={!!busy}>
            {p.user.revoke}
          </Button>
        )
      }
    >
      <p className="adm-sub-status">
        <TierBadge subscription={s} />
        <span className="num">{status}</span>
      </p>

      {canEdit && (
        <>
          {extendable ? (
            <div className="adm-sub-block">
              <p className="adm-sub-label">{p.user.extend}</p>
              <div className="adm-sub-row">
                {[7, 30, 90].map((n) => (
                  <Button key={n} variant="soft" loading={busy === `extend-${n}`} disabled={!!busy} onClick={() => extend(n)}>
                    +{n}
                  </Button>
                ))}
              </div>
              <form className="adm-sub-row adm-sub-custom" onSubmit={custom.onSubmit((v) => extend(Number(v.days), 'extend-custom'))} noValidate>
                <Field label={p.user.extendCustom} error={custom.errors.days}>
                  <Input type="number" inputMode="numeric" min={1} max={3650} {...custom.field('days')} />
                </Field>
                <Button type="submit" variant="soft" disabled={!custom.values.days || !!busy} loading={busy === 'extend-custom'}>
                  {isDays(custom.values.days) ? fmt(p.user.extendBy, { days: custom.values.days }) : p.user.extend}
                </Button>
              </form>
            </div>
          ) : (
            s && <p className="t-muted t-s adm-sub-block">{p.user.extendNoExpiry}</p>
          )}

          <form className="adm-sub-block adm-sub-row adm-sub-grant" onSubmit={grant} noValidate>
            <Field label={p.user.grantTier}>
              <Select {...grantForm.field('tier')}>
                {TIERS.map((x) => (
                  <option key={x} value={x}>
                    {t.tier[x]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={p.user.grantUntil} hint={grantForm.errors.until ? undefined : p.user.grantUntilHint} error={grantForm.errors.until}>
              <Input type="date" min={tomorrow} {...grantForm.field('until')} />
            </Field>
            <Button type="submit" variant="soft" loading={busy === 'grant'} disabled={!!busy}>
              {p.user.grant}
            </Button>
          </form>
        </>
      )}
    </Section>
  )
}

/** 1 to 3650 whole days, the range the extend endpoint takes. */
function isDays(v: string) {
  const n = Number(v)
  return v !== '' && Number.isInteger(n) && n >= 1 && n <= 3650
}
