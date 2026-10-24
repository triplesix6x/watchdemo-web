// Smooth scroll on ONE clock: Lenis is driven by gsap.ticker and ScrollTrigger reads
// Lenis. Under reduced motion there is no Lenis and ScrollTrigger reads native scroll.
import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prefersReducedMotion } from './env'

let lenis: Lenis | null = null
let native = false

export function initScroll() {
  gsap.registerPlugin(ScrollTrigger)
  if (lenis || native) return
  if (prefersReducedMotion()) {
    native = true
    return
  }
  lenis = new Lenis({
    lerp: 0.12,
    wheelMultiplier: 1,
    touchMultiplier: 1.2,
    anchors: true,
    // Without this Lenis eats every wheel event and inner scrollers (admin tables, sidebar) never move.
    allowNestedScroll: true,
  })
  lenis.on('scroll', () => ScrollTrigger.update())
  gsap.ticker.add((time) => lenis?.raf(time * 1000))
  gsap.ticker.lagSmoothing(0)
}

let locks = 0
/** Freeze page scroll (dialogs, the mobile menu). Counted; call the returned release once. */
export function lockScroll(): () => void {
  if (locks++ === 0) {
    lenis?.stop()
    document.documentElement.style.overflow = 'hidden'
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--locks === 0) {
      lenis?.start()
      document.documentElement.style.overflow = ''
    }
  }
}

export const stopScroll = () => lenis?.stop()
export const startScroll = () => {
  if (locks === 0) lenis?.start()
}

export function resetScroll() {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true })
  else scrollTo(0, 0)
}

export function scrollToTarget(target: string | HTMLElement | number, opts: { immediate?: boolean; offset?: number } = {}) {
  const offset = opts.offset ?? -80 // clear the sticky header
  if (lenis) {
    lenis.resize() // content that just arrived (fetched lists) is past its cached limit
    lenis.scrollTo(target, { duration: 1.1, immediate: opts.immediate, offset, easing: (t) => 1 - Math.pow(1 - t, 4) })
    return
  }
  const el = typeof target === 'number' ? null : typeof target === 'string' ? document.querySelector(target) : target
  const top = typeof target === 'number' ? target : el ? el.getBoundingClientRect().top + scrollY + offset : null
  if (top !== null) scrollTo({ top })
}
