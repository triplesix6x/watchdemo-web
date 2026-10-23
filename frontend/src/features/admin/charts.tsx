// Charts of the admin overview, hand-rolled SVG (dataviz skill: thin marks, 2px gaps,
// recessive grid, tooltip on hover and keyboard focus, a table view, text in text tokens).
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Tier } from '../../api/types'
import { fmt, useLocale, useT } from '../../i18n'
import { formatDate, formatNumber, formatShortDate } from '../../lib/format'
import { Table } from '../../ui'
import { useAdminDict } from './useAdmin'

type Point = { date: string; count: number }

const H = 200
const PAD = { l: 32, r: 4, t: 12, b: 24 }

/** Smallest 1/2/5 x 10^k at or above x. */
function niceStep(x: number) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, x)))
  return ([1, 2, 5, 10].find((m) => m * pow >= x) ?? 10) * pow
}


/** A column with a 4 px rounded data end and a square foot on the baseline. */
function columnPath(x: number, y: number, w: number, base: number) {
  const r = Math.min(4, w / 2, base - y)
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`
}

export function SignupsChart({ points, stale }: { points: Point[]; stale?: boolean }) {
  const p = useAdminDict()
  const locale = useLocale()
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [active, setActive] = useState<number | null>(null)
  const descId = useId()

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const n = points.length
  const maxCount = Math.max(0, ...points.map((d) => d.count))
  const step = niceStep(Math.ceil(Math.max(1, maxCount) / 3))
  const top = step * 3
  const plotW = width - PAD.l - PAD.r
  const base = H - PAD.b
  const plotH = base - PAD.t
  const band = plotW / Math.max(1, n)
  const barW = Math.max(1, Math.min(24, band - 2))
  const xOf = (i: number) => PAD.l + i * band + (band - barW) / 2
  const yOf = (c: number) => base - (c / top) * plotH
  const labelEvery = Math.ceil(n / Math.max(2, Math.floor(plotW / 72)))

  const total = points.reduce((s, d) => s + d.count, 0)
  const peak = points.reduce<Point | null>((m, d) => (!m || d.count > m.count ? d : m), null)
  const summary = fmt(p.overview.signupsSummary, {
    days: n,
    total: formatNumber(total, locale),
    max: peak?.count ?? 0,
    date: peak ? formatShortDate(peak.date, locale) : '',
  })

  const pickAt = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect()
    const i = Math.floor((clientX - rect.left - PAD.l) / band)
    setActive(Math.max(0, Math.min(n - 1, i)))
  }
  const onKey = (e: KeyboardEvent) => {
    const i = active ?? n - 1
    const next = e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null
    if (next === null) return
    e.preventDefault()
    setActive(Math.max(0, Math.min(n - 1, next)))
  }

  const cur = active !== null ? points[active] : null
  const readout = cur ? `${fmt(p.overview.perDay, { count: cur.count })}, ${formatDate(cur.date, locale)}` : ''
  const tipLeft = active !== null ? Math.min(Math.max(xOf(active) + barW / 2, 60), width - 60) : 0

  return (
    <figure className="adm-chart" data-stale={stale || undefined}>
      <p id={descId} className="sr-only">
        {summary}
      </p>
      <div
        ref={box}
        className="adm-chart-plot"
        tabIndex={0}
        role="group"
        aria-roledescription={locale === 'ru' ? 'график' : 'chart'}
        aria-label={p.overview.signups}
        aria-describedby={descId}
        onPointerMove={(e) => pickAt(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? n - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden="true">
          {[0, 1, 2, 3].map((k) => {
            const y = yOf(step * k)
            return (
              <g key={k}>
                <line x1={PAD.l} x2={width - PAD.r} y1={y} y2={y} className="adm-grid" />
                <text x={PAD.l - 8} y={y} dy="0.32em" textAnchor="end" className="adm-axis">
                  {formatNumber(step * k, locale)}
                </text>
              </g>
            )
          })}
          {points.map((d, i) =>
            d.count > 0 ? <path key={d.date} d={columnPath(xOf(i), yOf(d.count), barW, base)} className="adm-col" data-on={active === i || undefined} /> : null,
          )}
          {points.map((d, i) =>
            (n - 1 - i) % labelEvery === 0 ? (
              <text key={d.date} x={xOf(i) + barW / 2} y={H - 6} textAnchor="middle" className="adm-axis">
                {formatShortDate(d.date, locale)}
              </text>
            ) : null,
          )}
          {active !== null && <line x1={xOf(active) + barW / 2} x2={xOf(active) + barW / 2} y1={PAD.t} y2={base} className="adm-cross" />}
        </svg>
        {cur && (
          <div className="adm-tip card-raised" style={{ left: tipLeft, top: Math.max(0, yOf(cur.count) - 52) }} aria-hidden="true">
            <strong className="num">{formatNumber(cur.count, locale)}</strong>
            <span>{formatDate(cur.date, locale)}</span>
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {readout}
        </span>
      </div>
      <details className="adm-table-toggle">
        <summary>{p.overview.showTable}</summary>
        <Table label={summary} className="adm-chart-table">
          <thead>
            <tr>
              <th scope="col">{p.overview.date}</th>
              <th scope="col" className="num">
                {p.overview.count}
              </th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((d) => (
              <tr key={d.date}>
                <td>{formatDate(d.date, locale)}</td>
                <td className="num">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </details>
    </figure>
  )
}

// Ordered single-hue ramp (validated with the dataviz validator, --ordinal, on ink-900):
// more plan, lighter step. "No plan" is the darkest step, not grey, so the order reads.
const TIER_ORDER: (Tier | 'none')[] = ['pro', 'plus', 'basic', 'none']
const TIER_FILL: Record<Tier | 'none', string> = { pro: '#c3dafc', plus: '#7eb1f7', basic: '#3b7fdf', none: '#2a5a9e' }

export function TierSplit({ tiers }: { tiers: Record<Tier | 'none', number> }) {
  const t = useT()
  const p = useAdminDict()
  const locale = useLocale()
  const total = TIER_ORDER.reduce((s, k) => s + tiers[k], 0)
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0)
  const name = (k: Tier | 'none') => (k === 'none' ? t.tier.none : t.tier[k])
  return (
    <figure className="adm-tiers">
      <div className="adm-tiers-bar" role="img" aria-label={`${p.overview.tiersSummary}: ${TIER_ORDER.map((k) => `${name(k)} ${tiers[k]}`).join(', ')}`}>
        {TIER_ORDER.filter((k) => tiers[k] > 0).map((k) => (
          <span key={k} style={{ flexGrow: tiers[k], background: TIER_FILL[k] }} title={`${name(k)}: ${tiers[k]} (${pct(tiers[k])}%)`} />
        ))}
      </div>
      <ul className="adm-legend">
        {TIER_ORDER.map((k) => (
          <li key={k}>
            <span className="adm-swatch" style={{ background: TIER_FILL[k] }} aria-hidden="true" />
            <span className="adm-legend-name">{name(k)}</span>
            <span className="num">{formatNumber(tiers[k], locale)}</span>
            <span className="num adm-legend-pct">{pct(tiers[k])}%</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}
