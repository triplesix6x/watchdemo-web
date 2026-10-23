// Round 13 of Falcons vs Spirit on de_mirage (SPEC §2), the one variable behind the home
// page: round time in seconds after freeze end. The events are tiny and bundled (named
// JSON imports tree-shake away the frames); the 8 Hz frames are fetched as a hashed asset
// so the main bundle stays small.
import { end, kills, plant, players } from '../../assets/demo/mirage-r13.json'
import framesUrl from '../../assets/demo/mirage-r13.json?url'

export type Side = 't' | 'ct'

const TICK_RATE = 64
const sec = (tick: number) => tick / TICK_RATE

export const ROUND = {
  sides: players.map((p) => p.side as Side),
  kills: kills.map((k) => ({ t: sec(k.t), killer: k.killer, victim: k.victim })),
  plant: { t: sec(plant.t), x: plant.xy[0], y: plant.xy[1] },
  defuse: sec(end.t),
  duration: 75,
}
export type Round = typeof ROUND

/** Chapter anchors (SPEC §2 table, ordered by when the event happens in the round).
 *  The hero opens mid-execute at 0:26: ten players, trails, the plant just ahead. */
export const EVENTS = {
  hero: 26,
  plant: ROUND.plant.t,
  firstKill: ROUND.kills[0].t,
  retake: ROUND.kills[1].t,
  defuse: ROUND.defuse,
}

/** Positions as one flat array: frame f, player i at ((f * N) + i) * 3 = x, y, yaw. */
export type Frames = { t0: number; dt: number; count: number; data: Float32Array }
const N = 10

type RawFile = { sampleEveryTicks: number; frames: [number, [number, number, number, number, number][]][] }

export function parseFrames(raw: RawFile): Frames {
  const data = new Float32Array(raw.frames.length * N * 3)
  raw.frames.forEach(([, ps], f) => {
    for (const [i, x, y, , yaw] of ps) data.set([x, y, yaw], (f * N + i) * 3)
  })
  return { t0: sec(raw.frames[0][0]), dt: sec(raw.sampleEveryTicks), count: raw.frames.length, data }
}

let pending: Promise<Frames> | null = null
export function loadFrames(): Promise<Frames> {
  pending ??= fetch(framesUrl)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`round data: ${r.status}`))))
    .then(parseFrames)
  pending.catch(() => (pending = null))
  return pending
}

export type Pose = { x: number; y: number; yaw: number }

/** Player i at time t, linearly interpolated between frames; yaw takes the short way round. */
export function pose(fr: Frames, i: number, t: number, out: Pose = { x: 0, y: 0, yaw: 0 }): Pose {
  const f = Math.min(Math.max((t - fr.t0) / fr.dt, 0), fr.count - 1)
  const f0 = Math.floor(f)
  const f1 = Math.min(f0 + 1, fr.count - 1)
  const a = f - f0
  const p = (f0 * N + i) * 3
  const q = (f1 * N + i) * 3
  const d = fr.data
  const dyaw = ((((d[q + 2] - d[p + 2]) % 360) + 540) % 360) - 180
  out.x = d[p] + (d[q] - d[p]) * a
  out.y = d[p + 1] + (d[q + 1] - d[p + 1]) * a
  out.yaw = d[p + 2] + dyaw * a
  return out
}

/** Time player i died, or Infinity. */
export const deathTime = (i: number) => ROUND.kills.find((k) => k.victim === i)?.t ?? Infinity

/** 0:26 */
export function clock(t: number) {
  const s = Math.max(0, Math.floor(t))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
