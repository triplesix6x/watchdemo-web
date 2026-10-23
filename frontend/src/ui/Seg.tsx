import { useId, type KeyboardEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { LocalLink, splitLocale } from '../i18n'

export type SegItem<V extends string> = { value: V; label: ReactNode; count?: number; disabled?: boolean }

type SegProps<V extends string> = {
  items: SegItem<V>[]
  value: V
  onChange: (value: V) => void
  /** Accessible name of the group. */
  label: string
  className?: string
}

// Roving tabindex: one stop in the tab order; arrows, Home and End move and select.
function roving(e: KeyboardEvent<HTMLElement>, select: (value: string) => void) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-value]:not([disabled])')]
  const i = items.indexOf(document.activeElement as HTMLElement)
  const next =
    e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1
    : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1
    : e.key === 'Home' ? 0
    : e.key === 'End' ? items.length - 1
    : null
  if (next === null || !items.length) return
  e.preventDefault()
  const el = items[(next + items.length) % items.length]
  el.focus()
  select(el.dataset.value!)
}

function Group<V extends string>({ items, value, onChange, label, className = '', kind, idBase }: SegProps<V> & { kind: 'radio' | 'tab'; idBase?: string }) {
  return (
    <div
      role={kind === 'radio' ? 'radiogroup' : 'tablist'}
      aria-label={label}
      className={`seg ${className}`}
      onKeyDown={(e) => roving(e, (v) => onChange(v as V))}
    >
      {items.map((it) => {
        const on = it.value === value
        const a11y =
          kind === 'radio'
            ? { role: 'radio', 'aria-checked': on }
            : { role: 'tab', 'aria-selected': on, id: `${idBase}-tab-${it.value}`, 'aria-controls': `${idBase}-panel-${it.value}` }
        return (
          <button key={it.value} type="button" data-value={it.value} tabIndex={on ? 0 : -1} disabled={it.disabled} className="seg-item" onClick={() => onChange(it.value)} {...a11y}>
            {it.label}
            {it.count !== undefined && <span className="seg-count">{it.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Segmented control (a radio group) for filters and modes. Selection follows focus. */
export function Seg<V extends string>(props: SegProps<V>) {
  return <Group {...props} kind="radio" />
}

/** In-page tabs. Give the active panel tabPanelProps(idBase, value). */
export function Tabs<V extends string>({ idBase, ...props }: SegProps<V> & { idBase?: string }) {
  const auto = useId()
  return <Group {...props} kind="tab" idBase={idBase ?? auto} />
}

export const tabPanelProps = (idBase: string, value: string) => ({
  role: 'tabpanel' as const,
  id: `${idBase}-panel-${value}`,
  'aria-labelledby': `${idBase}-tab-${value}`,
  tabIndex: 0,
})

/** Tabs that are routes (admin sections): links in a nav, the current one marked.
 *  `to` is unprefixed. `end` matches the exact path only. */
export function SegNav({ items, label, className = '' }: { items: { to: string; label: ReactNode; end?: boolean }[]; label: string; className?: string }) {
  const { path } = splitLocale(useLocation().pathname)
  return (
    <nav aria-label={label} className={`seg ${className}`}>
      {items.map((it) => {
        const current = it.end ? path === it.to : path === it.to || path.startsWith(it.to + '/')
        return (
          <LocalLink key={it.to} to={it.to} className="seg-item" aria-current={current ? 'page' : undefined}>
            {it.label}
          </LocalLink>
        )
      })}
    </nav>
  )
}
