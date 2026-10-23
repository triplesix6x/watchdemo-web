// Motion engine core: one clock (gsap.ticker drives Lenis and ScrollTrigger), a page
// lifecycle that reverts every effect on navigation, the curtain transition and the
// data-attribute reveals. No DOM access at import time, so it is safe on the server.
// The React adapter (engine/react.tsx) calls boot / leave / enter; pages use usePage.
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { initScroll, resetScroll, startScroll, stopScroll } from './scroll'
import { initReveals } from './reveal'
import { playEnter, playLeave } from './transition'
import { prefersReducedMotion } from './env'

export { scrollToTarget, lockScroll } from './scroll'
export { setTransition, type Transition } from './transition'
export { ease, isTouch, isMobile, prefersReducedMotion } from './env'
export { gsap, ScrollTrigger }

export type PageContext = { intro: gsap.core.Timeline; path: string }
export type PageFn = (page: PageContext) => void | (() => void)

const pageFns = new Set<PageFn>()
const cleanups: (() => void)[] = []
let ctx: gsap.Context | null = null
let intro: gsap.core.Timeline | null = null
let ready = false
let booted = false

/** Global module hook: run fn on every page load (and now, if a page is ready), inside a
 *  gsap.context that is reverted on navigation. Returns an unsubscribe. In components,
 *  prefer usePage from engine/react. */
export function onPage(fn: PageFn) {
  pageFns.add(fn)
  if (ready) runPageFn(fn)
  return () => {
    pageFns.delete(fn)
  }
}

function runPageFn(fn: PageFn) {
  ctx?.add(() => {
    const c = fn({ intro: intro!, path: location.pathname })
    if (typeof c === 'function') cleanups.push(c)
  })
}

/** The current page's intro timeline (data-intro reveals). Null before the first page. */
export const pageIntro = () => intro
export const isBooted = () => booted

function syncFlags() {
  const h = document.documentElement.classList
  h.add('js', 'is-booted')
  h.toggle('motion', !prefersReducedMotion())
}

function initPage() {
  syncFlags()
  ctx = gsap.context(() => {
    intro = initReveals(document)
  })
  ready = true
  pageFns.forEach(runPageFn)
  requestAnimationFrame(() => ScrollTrigger.refresh())
}

// Next frame: components add to the intro in their effects (usePage) after the page init.
function playIntro() {
  const i = intro
  requestAnimationFrame(() => i?.play())
}

/** First load, on the client after hydration. Idempotent. */
export function boot() {
  if (booted) return
  booted = true
  syncFlags()
  initScroll()
  initPage()
  playIntro()
}

/** Cover the screen. Resolves when the curtain is closed. */
export async function leave() {
  stopScroll()
  await playLeave()
}

/** Revert the current page: tweens, ScrollTriggers, splits and onPage cleanups. */
export function cleanup() {
  if (!ready) return
  ready = false
  cleanups.splice(0).forEach((c) => c())
  ctx?.revert()
  ctx = null
}

/** After the new page is in the DOM: reset scroll, init, uncover, play the intro. */
export async function enter({ transition = false, scrollTop = true } = {}) {
  if (!booted) return
  cleanup()
  if (scrollTop) resetScroll()
  initPage()
  if (transition) await playEnter()
  startScroll()
  playIntro()
}
