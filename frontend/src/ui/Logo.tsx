// The WatchDemo mark: four corner brackets and a cross. Inline SVG so the colour comes
// from currentColor and every part is addressable for animation (.logo-tl, .logo-tr,
// .logo-bl, .logo-br, .logo-cross; corners carry --dx/--dy, their outward diagonal).
// Styles and keyframes live in styles/brand.css.
import type { CSSProperties } from 'react'

const PARTS: { cls: string; d: string; dir?: [number, number] }[] = [
  { cls: 'logo-tl', dir: [-1, -1], d: 'M180 180H360V278L456 402V458H402L278 360H180Z' },
  { cls: 'logo-tr', dir: [1, -1], d: 'M844 180H664V278L568 402V458H622L746 360H844Z' },
  { cls: 'logo-bl', dir: [-1, 1], d: 'M180 844H360V746L456 622V566H402L278 664H180Z' },
  { cls: 'logo-br', dir: [1, 1], d: 'M844 844H664V746L568 622V566H622L746 664H844Z' },
  { cls: 'logo-cross', d: 'M494 414H530V494H610V530H530V610H494V530H414V494H494Z' },
]

export type LogoProps = {
  size?: number
  /** Play the entrance once: corners fly in, then the cross grows with a 90 degree turn. */
  intro?: boolean
  className?: string
  /** Accessible name; null makes the mark decorative. */
  label?: string | null
}

export function Logo({ size = 18, intro = false, className = '', label = 'WatchDemo' }: LogoProps) {
  return (
    <span
      className={`logo${intro ? ' logo-intro' : ''} ${className}`}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      {PARTS.map((p) => (
        <svg
          key={p.cls}
          className={`logo-part ${p.cls}`}
          style={p.dir ? ({ '--dx': p.dir[0], '--dy': p.dir[1] } as CSSProperties) : undefined}
          viewBox="0 0 1024 1024"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d={p.d} />
        </svg>
      ))}
    </span>
  )
}

/** Big loader on the mark, a 3 s cycle. Use for waits over a second (or a full-screen gate). */
export function LogoLoader({ size = 48, label = null, className = '' }: { size?: number; label?: string | null; className?: string }) {
  return (
    <div className={`logo-loader ${className}`} role="status" aria-label={label ?? 'Загрузка'}>
      <Logo size={size} label={null} />
      {label && <div className="logo-loader-label">{label}</div>}
    </div>
  )
}

/** Small loader (12-16 px), coloured by currentColor. For waits of 100 ms to 1 s, inline. */
export function MiniLoader({ size = 14, label = 'Загрузка', className = '' }: { size?: number; label?: string; className?: string }) {
  return (
    <span className={`mini-loader ${className}`} role="status" aria-label={label}>
      <Logo size={size} label={null} />
    </span>
  )
}
