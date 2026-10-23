// Wires the home story to the radar driver: scroll position -> round time (anchors.ts),
// the intro replay from 0:00, the idle loop while the stage is on screen, dragging and
// arrow keys on the timeline (they scroll the page to that moment of the round), the
// hotkey strip and the active chapter. Everything runs inside usePage, so it is reverted
// on navigation; the ticker only runs while the story is on screen.
import type { RefObject } from 'react'
import { ease, gsap, prefersReducedMotion, ScrollTrigger, scrollToTarget } from '../../engine'
import { usePage } from '../../engine/react'
import { createDriver } from '../radar/driver'
import { EVENTS, loadFrames, ROUND } from '../radar/round'
import { scrollFor, timeAt, type Anchor } from './anchors'

const NARROW = '(max-width: 899px)'
const INTRO_AT_S = 0.6 // when the veil starts opening (radar.css), relative to mount

export function useStory(storyRef: RefObject<HTMLElement>, radarRef: RefObject<HTMLDivElement>) {
  usePage(() => {
    const story = storyRef.current
    const radar = radarRef.current
    if (!story || !radar) return
    const mountedAt = performance.now()
    const reduced = prefersReducedMotion()
    const driver = createDriver(radar, { idle: !reduced, initial: EVENTS.hero })
    const chapters = [...story.querySelectorAll<HTMLElement>('[data-t]')]
    const keys = [...story.querySelectorAll<HTMLElement>('[data-key]')]
    const track = radar.querySelector<HTMLElement>('[role="slider"]')

    let anchors: Anchor[] = [{ y: 0, t: EVENTS.hero }]
    const measure = () => {
      // The reading line: where a chapter's top sits when its event plays. On phones it
      // is below the sticky radar band.
      const line = innerHeight * (matchMedia(NARROW).matches ? 0.6 : 0.42)
      const top = (el: HTMLElement) => el.getBoundingClientRect().top + scrollY
      anchors = [{ y: 0, t: EVENTS.hero }]
      for (const el of chapters) anchors.push({ y: Math.max(anchors[anchors.length - 1].y + 1, top(el) - line), t: +el.dataset.t! })
      const end = top(story) + story.offsetHeight - innerHeight
      anchors.push({ y: Math.max(anchors[anchors.length - 1].y + 1, end), t: ROUND.duration })
    }

    let ticking = false
    const run = (on: boolean) => {
      if (on === ticking) return
      ticking = on
      if (on) gsap.ticker.add(driver.tick)
      else gsap.ticker.remove(driver.tick)
    }
    const st = ScrollTrigger.create({
      trigger: story,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (s) => driver.set(timeAt(anchors, s.scroll(), reduced)),
      onRefresh: (s) => {
        measure()
        driver.set(timeAt(anchors, s.scroll(), reduced))
      },
      onToggle: (s) => run(s.isActive),
    })
    measure()
    driver.set(timeAt(anchors, st.scroll(), reduced))
    run(st.isActive)
    document.fonts?.ready.then(() => ScrollTrigger.refresh())

    // Keycaps light one after another while the set chapter plays (plant to first kill),
    // and the chapter whose event is playing is marked active.
    const off = driver.on((t) => {
      const k = Math.floor(((t - EVENTS.plant) / (EVENTS.firstKill - EVENTS.plant)) * keys.length)
      keys.forEach((el, i) => el.classList.toggle('is-lit', i === k))
      chapters.forEach((el, i) => el.classList.toggle('is-active', t >= +el.dataset.t! && !(t >= +(chapters[i + 1]?.dataset.t ?? Infinity))))
    })

    let intro: gsap.core.Tween | null = null
    if (!reduced) driver.setIntro(0)
    loadFrames().then(
      (frames) => {
        driver.load(frames)
        if (reduced) return
        const k = { v: 0 }
        intro = gsap.to(k, {
          v: 1,
          duration: 1.9,
          ease: ease.settle,
          delay: Math.max(0, INTRO_AT_S - (performance.now() - mountedAt) / 1000),
          onUpdate: () => driver.setIntro(k.v),
        })
      },
      () => driver.setIntro(1), // no frames: the map and the timeline still stand
    )

    // Seeking scrolls the page to the moment, so the copy and the radar never disagree.
    const seek = (t: number, immediate = false) => scrollToTarget(scrollFor(anchors, t), { immediate, offset: 0 })
    const fromX = (e: PointerEvent) => {
      const r = track!.getBoundingClientRect()
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * ROUND.duration
    }
    let dragging = false
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      dragging = true
      track!.setPointerCapture(e.pointerId)
      track!.classList.add('is-dragging')
      seek(fromX(e), true)
    }
    const move = (e: PointerEvent) => dragging && seek(fromX(e), true)
    const up = () => {
      dragging = false
      track!.classList.remove('is-dragging')
    }
    const key = (e: KeyboardEvent) => {
      const now = timeAt(anchors, scrollY)
      const to: Record<string, number> = {
        ArrowRight: now + 2,
        ArrowUp: now + 2,
        ArrowLeft: now - 2,
        ArrowDown: now - 2,
        PageUp: now + 10,
        PageDown: now - 10,
        Home: 0,
        End: ROUND.duration,
      }
      if (!(e.key in to)) return
      e.preventDefault()
      seek(to[e.key])
    }
    const jump = (e: Event) => {
      e.preventDefault()
      e.stopPropagation() // Lenis would scroll to the hash as well
      seek(+(e.currentTarget as HTMLElement).dataset.seek!)
    }
    const seekLinks = [...story.querySelectorAll<HTMLElement>('[data-seek]')]
    track?.addEventListener('pointerdown', down)
    track?.addEventListener('pointermove', move)
    track?.addEventListener('pointerup', up)
    track?.addEventListener('pointercancel', up)
    track?.addEventListener('keydown', key)
    seekLinks.forEach((a) => a.addEventListener('click', jump))

    return () => {
      run(false)
      off()
      intro?.kill()
      driver.destroy()
      track?.removeEventListener('pointerdown', down)
      track?.removeEventListener('pointermove', move)
      track?.removeEventListener('pointerup', up)
      track?.removeEventListener('pointercancel', up)
      track?.removeEventListener('keydown', key)
      seekLinks.forEach((a) => a.removeEventListener('click', jump))
    }
  }, [])
}
