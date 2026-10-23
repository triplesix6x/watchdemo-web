// Declarative motion through data attributes:
//   data-split="lines|words|chars"   masked text reveal (SplitText), on scroll or with the intro
//   data-reveal="up|fade|clip|scale"  block reveal
//   data-intro                        play with the page intro instead of on scroll
//   data-delay="0.2"                  extra delay in seconds
//   data-parallax="0.15"              scrubbed vertical drift (fraction of the element height)
// Skipped under reduced motion; CSS keeps content visible without JS (html.motion gate).
// Put data-split only on text React never re-renders: SplitText rewrites the DOM inside.
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { ease, prefersReducedMotion } from './env'

const durations = { lines: 1.1, words: 1, chars: 0.8 } as const
const staggers = { lines: 0.07, words: 0.03, chars: 0.016 } as const

// autoSplit re-splits after a font load or resize. A text that already revealed must stay
// revealed, so the state lives outside onSplit.
function splitTween(el: HTMLElement, isIntro: boolean) {
  const type = (el.dataset.split || 'lines') as keyof typeof durations
  const delay = parseFloat(el.dataset.delay || '0')
  const s = { tween: undefined as gsap.core.Tween | undefined, done: false, requested: false }
  SplitText.create(el, {
    type: type === 'lines' ? 'lines' : `lines,${type}`,
    mask: 'lines',
    autoSplit: true,
    linesClass: 'split-line',
    onSplit(self) {
      gsap.set(el, { visibility: 'visible' })
      if (s.done) return
      const targets = type === 'lines' ? self.lines : type === 'words' ? self.words : self.chars
      s.tween = gsap.from(targets, {
        yPercent: 110,
        duration: durations[type],
        stagger: staggers[type],
        ease: ease.settle,
        delay,
        paused: isIntro && !s.requested,
        onComplete: () => {
          s.done = true
        },
        scrollTrigger: isIntro ? undefined : { trigger: el, start: 'top 88%', once: true },
      })
      return s.tween
    },
  })
  return () => {
    s.requested = true
    s.tween?.play()
  }
}

function blockTween(el: HTMLElement, paused: boolean) {
  const kind = el.dataset.reveal || 'up'
  const delay = parseFloat(el.dataset.delay || '0')
  const from: gsap.TweenVars =
    kind === 'fade'
      ? { autoAlpha: 0 }
      : kind === 'clip'
        ? { clipPath: 'inset(100% 0% 0% 0%)', autoAlpha: 1 }
        : kind === 'scale'
          ? { scale: 1.08, clipPath: 'inset(8% 8% 8% 8%)', autoAlpha: 1 }
          : { y: 32, autoAlpha: 0 }
  const to: gsap.TweenVars = kind === 'clip' || kind === 'scale' ? { clipPath: 'inset(0% 0% 0% 0%)', scale: 1 } : {}
  gsap.set(el, { visibility: 'visible' })
  return gsap.fromTo(el, from, {
    ...to,
    y: 0,
    autoAlpha: 1,
    duration: kind === 'fade' ? 0.8 : 1.1,
    ease: ease.settle,
    delay,
    paused,
    scrollTrigger: paused ? undefined : { trigger: el, start: 'top 90%', once: true },
  })
}

/** Wire every reveal inside `root`. Returns the page intro timeline, paused. */
export function initReveals(root: ParentNode = document) {
  gsap.registerPlugin(ScrollTrigger, SplitText)
  const intro = gsap.timeline({ paused: true })
  if (prefersReducedMotion()) return intro

  root.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
    const isIntro = el.hasAttribute('data-intro')
    const play = splitTween(el, isIntro)
    if (isIntro) intro.add(play, 0)
  })
  root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
    const isIntro = el.hasAttribute('data-intro')
    const t = blockTween(el, isIntro)
    if (isIntro) intro.add(() => void t.play(), 0)
  })
  root.querySelectorAll<HTMLElement>('[data-parallax]').forEach((el) => {
    const amount = parseFloat(el.dataset.parallax || '0.15')
    gsap.fromTo(
      el,
      { yPercent: -amount * 100 },
      {
        yPercent: amount * 100,
        ease: 'none',
        scrollTrigger: { trigger: el.parentElement || el, start: 'top bottom', end: 'bottom top', scrub: true },
      },
    )
  })
  return intro
}
