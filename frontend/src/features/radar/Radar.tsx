// The radar stage markup: the map <img> (the LCP element, with real alt text), a canvas
// the driver paints the players on, and the round timeline with the real events. The
// server renders it at `initial` so the prerendered HTML is the first frame. `empty` is
// the 404's round: no players, no events, the clock at 0:00.
import { forwardRef } from 'react'
import { Logo } from '../../ui'
// WebP copies of assets/demo/mirage-radar.png (183 KB): 22 KB and 12 KB, same pixels.
import radar1024 from './radar-1024.webp'
import radar512 from './radar-512.webp'
import { clock, ROUND } from './round'
import './radar.css'

export type RadarProps = {
  alt: string
  caption: string
  /** Accessible name of the timeline slider; omit for a static radar. */
  sliderLabel?: string
  initial?: number
  empty?: boolean
  /** Play the logo intro and the veil opening from the cross (home hero). */
  intro?: boolean
  className?: string
}

const markers = [
  ...ROUND.kills.map((k) => ({ t: k.t, kind: `kill side-${ROUND.sides[k.killer]}` })),
  { t: ROUND.plant.t, kind: 'plant' },
  { t: ROUND.defuse, kind: 'defuse' },
]

export const Radar = forwardRef<HTMLDivElement, RadarProps>(function Radar(
  { alt, caption, sliderLabel, initial = 0, empty = false, intro = false, className = '' },
  ref,
) {
  const p = (initial / ROUND.duration) * 100
  const slider = sliderLabel
    ? {
        role: 'slider',
        tabIndex: 0,
        'aria-label': sliderLabel,
        'aria-valuemin': 0,
        'aria-valuemax': ROUND.duration,
        'aria-valuenow': Math.floor(initial),
        'aria-valuetext': clock(initial),
      }
    : { 'aria-hidden': true }
  return (
    <div ref={ref} className={`radar${empty ? ' is-empty' : ''}${intro ? ' is-intro' : ''} ${className}`}>
      <div className="radar-view">
        <img
          className="radar-map"
          src={radar1024}
          srcSet={`${radar512} 512w, ${radar1024} 1024w`}
          sizes="(max-width: 899px) 110vw, 60vw"
          width={1024}
          height={1024}
          alt={alt}
          {...{ fetchpriority: 'high' }}
        />
        {!empty && <canvas className="radar-canvas" aria-hidden="true" />}
        {intro && (
          <div className="radar-logo" aria-hidden="true">
            <Logo size={64} intro label={null} />
          </div>
        )}
      </div>
      <div className="radar-bar">
        <span className="radar-clock num">
          <span data-clock>{clock(initial)}</span>
          <span className="radar-clock-total"> / {clock(ROUND.duration)}</span>
        </span>
        <div className="radar-track" {...slider}>
          <div className="radar-fill" data-fill style={{ scale: `${p / 100} 1` }} />
          {!empty &&
            markers.map((m) => (
              <span
                key={m.t}
                className={`radar-mark ${m.kind}${initial >= m.t ? ' is-past' : ''}`}
                data-mt={m.t}
                style={{ left: `${(m.t / ROUND.duration) * 100}%` }}
              />
            ))}
          <div className="radar-rail" data-rail style={{ translate: `${p}% 0` }}>
            <span className="radar-thumb" />
          </div>
        </div>
        <p className="radar-caption">{caption}</p>
      </div>
    </div>
  )
})
