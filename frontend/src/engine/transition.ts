// Page transition for public pages: the logo's four corners converge from the viewport
// corners to cover the screen while the cross turns in, then spread open on the new page.
// Leave 0.24 s + enter 0.32 s, under the 600 ms budget. Reduced motion: a 150 ms
// cross-fade. Markup: <Curtain /> in engine/react.tsx. GSAP owns every transform here,
// so the curtain CSS sets none.
import { gsap } from 'gsap'
import { ease, prefersReducedMotion } from './env'

export type Transition = {
  leave: (curtain: HTMLElement) => gsap.core.Animation
  enter: (curtain: HTMLElement) => gsap.core.Animation
}

const quads = (c: HTMLElement) => gsap.utils.toArray<HTMLElement>(c.querySelectorAll('.curtain-q'))
// Outward direction of each quadrant, in the DOM order tl, tr, bl, br.
const DIR = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const

const corners: Transition = {
  leave: (c) =>
    gsap
      .timeline()
      .set(c, { autoAlpha: 1, opacity: 1 })
      .fromTo(
        quads(c),
        { xPercent: (i) => DIR[i][0] * 100, yPercent: (i) => DIR[i][1] * 100 },
        { xPercent: 0, yPercent: 0, duration: 0.24, ease: ease.inOut },
      )
      .fromTo(
        c.querySelector('.curtain-mark'),
        { scale: 0, rotate: -90, autoAlpha: 0 },
        { scale: 1, rotate: 0, autoAlpha: 1, duration: 0.18, ease: ease.soft },
        0.06,
      ),
  enter: (c) =>
    gsap
      .timeline()
      .to(c.querySelector('.curtain-mark'), { rotate: 90, scale: 0.6, autoAlpha: 0, duration: 0.14, ease: ease.soft })
      .to(
        quads(c),
        { xPercent: (i) => DIR[i][0] * 100, yPercent: (i) => DIR[i][1] * 100, duration: 0.32, ease: ease.settle },
        0.02,
      )
      .set(c, { autoAlpha: 0 }),
}

const fade: Transition = {
  leave: (c) =>
    gsap
      .timeline()
      .set(quads(c), { xPercent: 0, yPercent: 0 })
      .set(c.querySelector('.curtain-mark'), { autoAlpha: 0 })
      .fromTo(c, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.075, ease: 'none' }),
  enter: (c) => gsap.to(c, { autoAlpha: 0, duration: 0.075, ease: 'none' }),
}

let current = corners
/** Replace the transition (global, call once before boot). */
export const setTransition = (t: Transition) => {
  current = t
}
const pick = () => (prefersReducedMotion() ? fade : current)
const curtain = () => document.getElementById('curtain')

export const playLeave = () => {
  const c = curtain()
  return c ? Promise.resolve(pick().leave(c)) : Promise.resolve()
}
export const playEnter = () => {
  const c = curtain()
  return c ? Promise.resolve(pick().enter(c)) : Promise.resolve()
}
