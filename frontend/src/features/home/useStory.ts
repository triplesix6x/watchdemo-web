// The episode uses the existing page lifecycle and GSAP clock. Scroll is the only
// time source: no autonomous drift, so a selected event and the slider stay exact.
import type { RefObject } from 'react'
import { gsap, ScrollTrigger, scrollToTarget } from '../../engine'
import { usePage } from '../../engine/react'
import { createDriver } from '../radar/driver'
import { loadFrames, ROUND } from '../radar/round'
import { episodeAnchors, scrollFor, timeAt, type Anchor } from './anchors'

export function useStory(storyRef: RefObject<HTMLElement>, radarRef: RefObject<HTMLDivElement>) {
  usePage(() => {
    const story = storyRef.current
    const radar = radarRef.current
    if (!story || !radar) return
    const driver = createDriver(radar, { idle: false, initial: 0 })
    const chapters = [...story.querySelectorAll<HTMLElement>('[data-t]')]
    const track = radar.querySelector<HTMLElement>('[role="slider"]')
    let disposed = false
    let anchors: Anchor[] = []
    const measure = () => {
      const top = (el: HTMLElement) => el.getBoundingClientRect().top + scrollY
      const header = document.querySelector<HTMLElement>('.site-header')?.offsetHeight ?? 64
      const stage = story.querySelector<HTMLElement>('.story-stage')!
      const line = matchMedia('(max-width: 899px)').matches
        ? header + stage.offsetHeight + Math.max(0, innerHeight - header - stage.offsetHeight) / 2
        : innerHeight * 0.42
      anchors = episodeAnchors(
        top(story) - header,
        chapters.map((el) => ({ y: top(el) + el.offsetHeight / 2 - line, t: +el.dataset.t! })),
        top(story) + story.offsetHeight - innerHeight,
        ROUND.duration,
      )
    }

    let ticking = false
    const run = (on: boolean) => {
      if (on === ticking) return
      ticking = on
      if (on) gsap.ticker.add(driver.tick)
      else gsap.ticker.remove(driver.tick)
    }
    // Browsers quantize document scroll positions to pixels. Retain the exact
    // selected time until the user leaves that pixel, including 0 and duration.
    let selected: { y: number; t: number } | null = null
    const sync = (y: number) => {
      if (selected && Math.abs(y - selected.y) <= 1) driver.set(selected.t)
      else { selected = null; driver.set(timeAt(anchors, y)) }
    }
    const st = ScrollTrigger.create({
      trigger: story,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (s) => sync(s.scroll()),
      onRefresh: (s) => { measure(); sync(s.scroll()) },
      onToggle: (s) => run(s.isActive),
    })
    measure()
    sync(st.scroll())
    driver.tick(0, 0)
    run(st.isActive)
    document.fonts?.ready.then(() => { if (!disposed) ScrollTrigger.refresh() })
    const resize = new ResizeObserver(() => { if (!disposed) ScrollTrigger.refresh() })
    resize.observe(story)

    const off = driver.on((t) => {
      chapters.forEach((el, i) => el.classList.toggle('is-active', t >= +el.dataset.t! && !(t >= +(chapters[i + 1]?.dataset.t ?? Infinity))))
    })
    loadFrames().then((frames) => { if (!disposed) driver.load(frames) }, () => { /* The real map, events and timeline remain available if frame loading fails. */ })

    // User-controlled seeking stays continuous under reduced motion too; there is no
    // intro or idle autoplay. Instant scrolling avoids moving the reading position slowly.
    const seek = (t: number) => {
      const target = Math.max(0, Math.min(ROUND.duration, t))
      selected = { y: scrollFor(anchors, target), t: target }
      scrollToTarget(selected.y, { immediate: true, offset: 0 })
      driver.set(target)
      driver.tick(0, 0)
    }
    const fromX = (e: PointerEvent) => {
      const r = track!.getBoundingClientRect()
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * ROUND.duration
    }
    let dragging = false
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      track!.focus({ preventScroll: true })
      dragging = true
      track!.setPointerCapture(e.pointerId)
      track!.classList.add('is-dragging')
      seek(fromX(e))
    }
    const move = (e: PointerEvent) => { if (dragging) seek(fromX(e)) }
    const up = () => { dragging = false; track!.classList.remove('is-dragging') }
    const key = (e: KeyboardEvent) => {
      const now = driver.time
      const to: Record<string, number> = {
        ArrowRight: now + 2, ArrowUp: now + 2,
        ArrowLeft: now - 2, ArrowDown: now - 2,
        PageUp: now + 10, PageDown: now - 10,
        Home: 0, End: ROUND.duration,
      }
      if (!(e.key in to)) return
      e.preventDefault()
      seek(to[e.key])
    }
    const jump = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      seek(+(e.currentTarget as HTMLElement).dataset.seek!)
    }
    const seekLinks = [...story.querySelectorAll<HTMLElement>('[data-seek]')]
    track?.addEventListener('pointerdown', down)
    track?.addEventListener('pointermove', move)
    track?.addEventListener('pointerup', up)
    track?.addEventListener('pointercancel', up)
    track?.addEventListener('lostpointercapture', up)
    track?.addEventListener('keydown', key)
    seekLinks.forEach((a) => a.addEventListener('click', jump))

    return () => {
      disposed = true
      run(false)
      resize.disconnect()
      off()
      driver.destroy()
      track?.removeEventListener('pointerdown', down)
      track?.removeEventListener('pointermove', move)
      track?.removeEventListener('pointerup', up)
      track?.removeEventListener('pointercancel', up)
      track?.removeEventListener('lostpointercapture', up)
      track?.removeEventListener('keydown', key)
      seekLinks.forEach((a) => a.removeEventListener('click', jump))
    }
  }, [])
}
