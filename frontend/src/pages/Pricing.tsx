import type { ReactNode } from 'react'
import { AlertTriangle, Check, ChevronDown, Minus, RefreshCw } from 'lucide-react'
import { fmt, useDict, useLocale, useT } from '../i18n'
import ru from '../i18n/pages/pricing.ru'
import en from '../i18n/pages/pricing.en'
import { Head } from '../head/Head'
import { appApi } from '../api/endpoints'
import { TIERS, type FeatureId, type Tier, type TierInfo } from '../api/types'
import type { Dict as SharedDict } from '../i18n/ru'
import { useAsync } from '../lib/useAsync'
import { formatNumber, formatPrice } from '../lib/format'
import { Button, ButtonLink, Pending, Pill, Skeleton } from '../ui'
import { CONTACT_URL } from '../config'
import { PRICES, RECOMMENDED } from '../features/pricing/prices'
import { describeTierFeature, type FeatureDisplay } from '../features/pricing/tierFeatures'
import '../features/pricing/pricing.css'

type Dict = typeof ru
type Row = { id: FeatureId; cells: Record<Tier, FeatureDisplay> }

/** Keep server order, skip unnamed feature ids, and show missing tier data as unknown. */
function buildRows(tiers: TierInfo[], t: SharedDict, locale: 'ru' | 'en'): Row[] {
  const ids = [...new Set(tiers.flatMap((tier) => tier.features.map((f) => f.id)))].filter((id) => id in t.feature)
  return ids.map((id) => {
    const cell = (tier: Tier) => describeTierFeature(tiers.find((x) => x.id === tier)?.features.find((f) => f.id === id), t, (n) => formatNumber(n, locale))
    return { id, cells: { basic: cell('basic'), plus: cell('plus'), pro: cell('pro') } }
  })
}

function CellView({ cell, p }: { cell: FeatureDisplay; p: Dict }) {
  const t = useT()
  if (cell.kind === 'yes')
    return (
      <span className="pr-mark pr-yes">
        <Check size={16} aria-hidden />
        <span className="sr-only">{p.yes}</span>
      </span>
    )
  if (cell.kind === 'no')
    return (
      <span className="pr-mark pr-no">
        <Minus size={16} aria-hidden />
        <span className="sr-only">{p.no}</span>
      </span>
    )
  return <span className="pr-value num">{cell.kind === 'quota' ? <>{cell.value}<small className="pr-feature-hint">{cell.detail}</small></> : t.quota.unknown}</span>
}

function priceText(tier: Tier, p: Dict, locale: 'ru' | 'en') {
  const price = PRICES[tier]
  if (price.amount === 0) return p.free
  return fmt(p.perMonth, { price: formatPrice(price.amount, price.currency, locale) })
}

export default function Pricing() {
  const p = useDict({ ru, en })
  const t = useT()
  const locale = useLocale()
  const tiers = useAsync(() => appApi.tiers(), [])
  const rows = tiers.data ? buildRows(tiers.data, t, locale) : null

  // Loading and error take the place of the feature rows; tier names, prices and
  // actions are static, so the prerendered page already carries them.
  const status = (
    <StatusBlock p={p} error={tiers.loading ? undefined : tiers.error?.message} onRetry={tiers.reload}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height="1.25rem" />
      ))}
    </StatusBlock>
  )

  return (
    <div className="container pp pr">
      <Head title={p.meta.title} description={p.meta.description} />
      <header className="pp-head pr-head">
        <h1>{p.h1}</h1>
        <p className="t-lead">{p.lead}</p>
      </header>

      <div className="pr-table card">
        <table className="pr-grid">
          <caption className="sr-only">{p.tableLabel}</caption>
          <thead>
            <tr>
              <th scope="col" className="pr-feature">
                <span className="sr-only">{p.feature}</span>
              </th>
              {TIERS.map((tier) => (
                <th key={tier} scope="col" className={tier === RECOMMENDED ? 'is-rec' : undefined}>
                  <span className="pr-tier">{t.tier[tier]}</span>
                  {tier === RECOMMENDED && <Pill tone="brand">{p.recommended}</Pill>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="pr-feature">
                    <FeatureName p={p} t={t} id={row.id} />
                  </th>
                  {TIERS.map((tier) => (
                    <td key={tier} className={tier === RECOMMENDED ? 'is-rec' : undefined}>
                      <CellView cell={row.cells[tier]} p={p} />
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={TIERS.length + 1} className="pr-status">
                  {status}
                </td>
              </tr>
            )}
            <tr className="pr-price">
              <th scope="row" className="pr-feature">
                {p.price}
              </th>
              {TIERS.map((tier) => (
                <td key={tier} className={tier === RECOMMENDED ? 'is-rec' : undefined}>
                  <span className="pr-value">{priceText(tier, p, locale)}</span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Phones: one block per tier, the recommended one first. */}
      <div className="pr-stack">
        {[RECOMMENDED, ...TIERS.filter((x) => x !== RECOMMENDED)].map((tier) => (
          <section key={tier} className={`pr-block card${tier === RECOMMENDED ? ' is-rec' : ''}`} aria-labelledby={`tier-${tier}`}>
            <div className="pr-block-head">
              <h2 id={`tier-${tier}`} className="pr-tier">
                {t.tier[tier]}
              </h2>
              {tier === RECOMMENDED && <Pill tone="brand">{p.recommended}</Pill>}
            </div>
            <p className="pr-value">{priceText(tier, p, locale)}</p>
            {rows ? (
              <ul className="pr-block-list" role="list">
                {rows.map((row) => (
                  <li key={row.id} className={row.cells[tier].kind === 'no' ? 'is-off' : undefined}>
                    <span><FeatureName p={p} t={t} id={row.id} /></span>
                    <CellView cell={row.cells[tier]} p={p} />
                  </li>
                ))}
              </ul>
            ) : (
              status
            )}
          </section>
        ))}
      </div>

      <p className="section-lead">{t.quota.note}</p>

      <div className="pr-beta-action">
        <ButtonLink href={CONTACT_URL} variant="primary" size="lg" target="_blank" rel="noopener noreferrer">
          {locale === 'en' ? 'Request beta access' : 'Запросить бета-тестирование'}
        </ButtonLink>
      </div>

      <section className="pp-section pr-faq" aria-labelledby="access">
        <h2 id="access" className="pp-h2">
          {p.faqTitle}
        </h2>
        <div className="pr-faq-list">
          {p.faq.map((item, i) => (
            <details key={i} className="disclosure">
              <summary>
                {item.q}
                <ChevronDown size={16} aria-hidden className="disclosure-chevron" />
              </summary>
              <p className="disclosure-body">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  )
}

function FeatureName({ p, t, id }: { p: Dict; t: SharedDict; id: FeatureId }) {
  return (
    <>
      <span className="pr-feature-name">{t.feature[id]}</span>
      {p.hints[id] && <span className="pr-feature-hint">{p.hints[id]}</span>}
    </>
  )
}

function StatusBlock({ p, error, onRetry, children }: { p: Dict; error?: string; onRetry: () => void; children: ReactNode }) {
  const t = useT()
  if (!error)
    return (
      <Pending label={p.loading} className="pr-pending-block">
        {children}
      </Pending>
    )
  return (
    <div className="pr-error" role="alert">
      <AlertTriangle size={18} aria-hidden />
      <div>
        <p className="pr-error-title">{p.error.title}</p>
        <p className="pr-error-text">{error}</p>
      </div>
      <Button variant="soft" onClick={onRetry}>
        <RefreshCw size={15} aria-hidden className="nudge-spin" />
        {t.actions.retry}
      </Button>
    </div>
  )
}
