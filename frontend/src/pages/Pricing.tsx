import type { ReactNode } from 'react'
import { AlertTriangle, ArrowUpRight, Check, ChevronDown, Download as DownloadIcon, Minus, RefreshCw } from 'lucide-react'
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
import { GET_ACCESS_URL } from '../config'
import { PRICES, RECOMMENDED } from '../features/pricing/prices'
import '../features/pricing/pricing.css'

type Dict = typeof ru
type Cell = { kind: 'yes' } | { kind: 'no' } | { kind: 'limit'; n: number } | { kind: 'unlimited' }
type Row = { id: FeatureId; cells: Record<Tier, Cell> }

/** Rows in the server's order. A feature with a monthly limit on any tier reads as a
 *  quota ("10", "Без лимита"); the rest as included or not. Ids the page has no name
 *  for (a newer backend) are skipped rather than shown raw. */
function buildRows(tiers: TierInfo[], known: Record<string, unknown>): Row[] {
  const ids = (tiers[0]?.features ?? []).map((f) => f.id).filter((id) => id in known)
  return ids.map((id) => {
    const of = (tier: Tier) => tiers.find((t) => t.id === tier)?.features.find((f) => f.id === id)
    const quota = TIERS.some((tier) => of(tier)?.monthly_limit != null)
    const cell = (tier: Tier): Cell => {
      const f = of(tier)
      if (!f?.allowed) return { kind: 'no' }
      if (f.monthly_limit != null) return { kind: 'limit', n: f.monthly_limit }
      return quota ? { kind: 'unlimited' } : { kind: 'yes' }
    }
    return { id, cells: { basic: cell('basic'), plus: cell('plus'), pro: cell('pro') } }
  })
}

function CellView({ cell, p }: { cell: Cell; p: Dict }) {
  const locale = useLocale()
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
  return <span className="pr-value num">{cell.kind === 'limit' ? formatNumber(cell.n, locale) : p.unlimited}</span>
}

function priceText(tier: Tier, p: Dict, locale: 'ru' | 'en') {
  const price = PRICES[tier]
  if (price.placeholder || price.amount === null) return p.pricePending
  if (price.amount === 0) return p.free
  return fmt(p.perMonth, { price: formatPrice(price.amount, price.currency, locale) })
}

function TierAction({ tier, p }: { tier: Tier; p: Dict }) {
  const t = useT()
  if (tier === 'basic')
    return (
      <ButtonLink to="/download" variant="soft" block>
        <DownloadIcon size={16} aria-hidden className="nudge-down" />
        {p.downloadFree}
      </ButtonLink>
    )
  const primary = tier === RECOMMENDED
  return (
    <ButtonLink href={GET_ACCESS_URL} variant={primary ? 'primary' : 'soft'} block>
      {primary ? t.actions.getAccess : p.getPro}
      <ArrowUpRight size={16} aria-hidden className="nudge-out" />
    </ButtonLink>
  )
}

export default function Pricing() {
  const p = useDict({ ru, en })
  const t = useT()
  const locale = useLocale()
  const tiers = useAsync(() => appApi.tiers(), [])
  const rows = tiers.data ? buildRows(tiers.data, t.feature) : null

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
                  <span className={PRICES[tier].placeholder ? 'pr-pending' : 'pr-value'}>{priceText(tier, p, locale)}</span>
                </td>
              ))}
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td className="pr-feature" />
              {TIERS.map((tier) => (
                <td key={tier} className={tier === RECOMMENDED ? 'is-rec' : undefined}>
                  <TierAction tier={tier} p={p} />
                </td>
              ))}
            </tr>
          </tfoot>
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
            <p className={PRICES[tier].placeholder ? 'pr-pending' : 'pr-value'}>{priceText(tier, p, locale)}</p>
            {rows ? (
              <ul className="pr-block-list" role="list">
                {rows.map((row) => (
                  <li key={row.id} className={row.cells[tier].kind === 'no' ? 'is-off' : undefined}>
                    <span>{t.feature[row.id]}</span>
                    <CellView cell={row.cells[tier]} p={p} />
                  </li>
                ))}
              </ul>
            ) : (
              status
            )}
            <TierAction tier={tier} p={p} />
          </section>
        ))}
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
