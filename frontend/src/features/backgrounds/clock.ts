import { gsap } from 'gsap'

// React Bits expects one-shot RAF scheduling; route it through the site's GSAP clock.
let sequence = 0
const pending = new Map<number, FrameRequestCallback>()
let listening = false
function flush() {
  const now = performance.now()
  for (const [id, callback] of [...pending]) {
    if (pending.delete(id)) callback(now)
  }
  if (!pending.size) { gsap.ticker.remove(flush); listening = false }
}
export function requestSharedFrame(callback: FrameRequestCallback): number {
  const id = ++sequence
  pending.set(id, callback)
  if (!listening) { listening = true; gsap.ticker.add(flush) }
  return id
}
export function cancelSharedFrame(id: number): void {
  pending.delete(id)
  if (!pending.size && listening) { gsap.ticker.remove(flush); listening = false }
}
