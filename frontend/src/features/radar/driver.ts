// The radar driver: one variable (round time, seconds) fanned out to every visual that
// carries the concept: the canvas (dots, trails, view ticks, deaths, bomb, kill flashes),
// the clock, the timeline thumb and fill, the passed markers, and any subscriber (the
// hotkey strip, the active chapter). It renders on the GSAP ticker only, and only when
// the shown time or the canvas size changed.
//
// Shown time = (base + drift) * intro
//   base   set() by the page (scroll position mapped to round time)
//   drift  the idle loop: a slow swing of up to 2 s around base at 0.25x speed while
//          the page is still; it fades out as soon as base moves again
//   intro  0..1, replays the round from 0:00 into base when the page opens
import { gsap } from 'gsap'
import { clock, deathTime, pose, ROUND, type Frames, type Pose } from './round'

const TRAIL_S = 1.6
const TRAIL_STEP = 0.1
const FLASH_S = 1.1
const IDLE_AFTER_S = 0.5
const IDLE_SWING_S = 2
const IDLE_RATE = 0.25 // round seconds per real second at the steepest point of the swing

export type RadarDriver = ReturnType<typeof createDriver>

export function createDriver(root: HTMLElement, opts: { idle: boolean; initial: number }) {
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!
  const ctx = canvas.getContext('2d')!
  const clockEl = root.querySelector<HTMLElement>('[data-clock]')!
  const rail = root.querySelector<HTMLElement>('[data-rail]')!
  const fill = root.querySelector<HTMLElement>('[data-fill]')!
  const slider = root.querySelector<HTMLElement>('[role="slider"]')
  const markers = [...root.querySelectorAll<HTMLElement>('[data-mt]')].map((el) => ({ el, t: +el.dataset.mt!, past: el.classList.contains('is-past') }))

  const css = getComputedStyle(root)
  const color = { t: css.getPropertyValue('--side-t').trim(), ct: css.getPropertyValue('--side-ct').trim(), bomb: css.getPropertyValue('--danger').trim() }
  const deaths = ROUND.sides.map((_, i) => deathTime(i))
  const listeners = new Set<(t: number) => void>()

  let frames: Frames | null = null
  let base = opts.initial
  let intro = 1
  let drift = 0
  let phase = 0
  let stillFor = 0
  let shown = NaN
  let second = -1
  let size = 0
  let dirty = true

  const ro = new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect()
    const dpr = Math.min(devicePixelRatio || 1, 2)
    size = r.width
    canvas.width = Math.round(r.width * dpr)
    canvas.height = Math.round(r.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    dirty = true
  })
  ro.observe(canvas)

  function timeline(t: number) {
    const p = t / ROUND.duration
    rail.style.translate = `${(p * 100).toFixed(3)}% 0`
    fill.style.scale = `${p.toFixed(4)} 1`
    const s = Math.floor(t)
    if (s !== second) {
      second = s
      clockEl.textContent = clock(t)
      slider?.setAttribute('aria-valuenow', String(s))
      slider?.setAttribute('aria-valuetext', clock(t))
    }
    for (const m of markers) {
      const past = t >= m.t
      if (past !== m.past) m.el.classList.toggle('is-past', (m.past = past))
    }
  }

  const a: Pose = { x: 0, y: 0, yaw: 0 }
  const b: Pose = { x: 0, y: 0, yaw: 0 }

  function draw(t: number) {
    ctx.clearRect(0, 0, size, size)
    if (!frames || !size) return
    const fr = frames
    const S = size
    const r = Math.max(3.5, S * 0.0105)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // Trails: the last 1.6 s of movement, fading toward the tail.
    ctx.lineWidth = Math.max(1.25, r * 0.38)
    for (let i = 0; i < 10; i++) {
      const until = Math.min(t, deaths[i])
      ctx.strokeStyle = color[ROUND.sides[i]]
      pose(fr, i, until, a)
      for (let k = 1; k * TRAIL_STEP <= TRAIL_S; k++) {
        pose(fr, i, until - k * TRAIL_STEP, b)
        ctx.globalAlpha = 0.5 * (1 - k * TRAIL_STEP / TRAIL_S)
        ctx.beginPath()
        ctx.moveTo(a.x * S, a.y * S)
        ctx.lineTo(b.x * S, b.y * S)
        ctx.stroke()
        a.x = b.x
        a.y = b.y
      }
    }
    ctx.globalAlpha = 1

    // The bomb: pulses once a second while planted, turns CT blue once defused.
    if (t >= ROUND.plant.t) {
      const bx = ROUND.plant.x * S
      const by = ROUND.plant.y * S
      const defused = t >= ROUND.defuse
      const c = defused ? color.ct : color.bomb
      if (!defused) {
        const ph = (t - ROUND.plant.t) % 1
        ctx.globalAlpha = 0.7 * (1 - ph)
        ctx.strokeStyle = c
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(bx, by, r * (1.2 + ph * 2.6), 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
      ctx.fillStyle = c
      ctx.beginPath()
      ctx.moveTo(bx, by - r)
      ctx.lineTo(bx + r, by)
      ctx.lineTo(bx, by + r)
      ctx.lineTo(bx - r, by)
      ctx.closePath()
      ctx.fill()
    }

    // Kill flashes: a tracer from the killer and a ring on the victim, both fading.
    for (const k of ROUND.kills) {
      const p = (t - k.t) / FLASH_S
      if (p < 0 || p > 1) continue
      const c = color[ROUND.sides[k.killer]]
      pose(fr, k.killer, k.t, a)
      pose(fr, k.victim, k.t, b)
      ctx.strokeStyle = c
      ctx.globalAlpha = Math.max(0, 0.8 * (1 - p * 2))
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(a.x * S, a.y * S)
      ctx.lineTo(b.x * S, b.y * S)
      ctx.stroke()
      ctx.globalAlpha = 1 - p
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(b.x * S, b.y * S, r * (1.3 + p * 3.2), 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    for (let i = 0; i < 10; i++) {
      const c = color[ROUND.sides[i]]
      if (t >= deaths[i]) {
        // Dead: an X where they fell, at half strength, as in the app.
        pose(fr, i, deaths[i], a)
        const x = a.x * S
        const y = a.y * S
        const h = r * 0.62
        ctx.strokeStyle = c
        ctx.globalAlpha = 0.6
        ctx.lineWidth = Math.max(1.5, r * 0.32)
        ctx.beginPath()
        ctx.moveTo(x - h, y - h)
        ctx.lineTo(x + h, y + h)
        ctx.moveTo(x - h, y + h)
        ctx.lineTo(x + h, y - h)
        ctx.stroke()
        ctx.globalAlpha = 1
        continue
      }
      pose(fr, i, t, a)
      const x = a.x * S
      const y = a.y * S
      // The view tick points where the player looks (the app draws its cone at -yaw + 180).
      const ang = ((180 - a.yaw) * Math.PI) / 180
      ctx.strokeStyle = c
      ctx.lineWidth = Math.max(1.5, r * 0.36)
      ctx.beginPath()
      ctx.moveTo(x + Math.cos(ang) * r * 1.15, y + Math.sin(ang) * r * 1.15)
      ctx.lineTo(x + Math.cos(ang) * r * 2.2, y + Math.sin(ang) * r * 2.2)
      ctx.stroke()
      ctx.fillStyle = c
      ctx.strokeStyle = 'rgb(0 0 0 / 0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }

  function tick(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs, 100) / 1000
    if (opts.idle) {
      stillFor += dt
      if (stillFor > IDLE_AFTER_S) {
        phase += (dt * IDLE_RATE) / IDLE_SWING_S
        drift = IDLE_SWING_S * Math.sin(phase)
      } else {
        drift *= Math.pow(0.86, gsap.ticker.deltaRatio())
        phase = Math.asin(Math.max(-1, Math.min(1, drift / IDLE_SWING_S)))
      }
    }
    const t = Math.max(0, Math.min(ROUND.duration, (base + drift) * intro))
    if (!dirty && Math.abs(t - shown) < 1e-4) return
    dirty = false
    shown = t
    timeline(t)
    draw(t)
    listeners.forEach((fn) => fn(t))
  }

  return {
    /** The one variable: round time in seconds. */
    set(t: number) {
      if (t !== base) stillFor = 0
      base = t
    },
    setIntro(k: number) {
      intro = k
    },
    load(f: Frames) {
      frames = f
      dirty = true
    },
    get time() {
      return shown
    },
    tick,
    on(fn: (t: number) => void) {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    destroy() {
      ro.disconnect()
      listeners.clear()
    },
  }
}
