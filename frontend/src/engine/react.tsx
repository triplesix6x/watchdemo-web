// React Router adapter for the engine, plus the hooks pages use.
//   <Engine isTransitionPath={fn} />  once, inside the router: curtain + link interception
//   <PageReady />                     after each page (the router does this): boot or enter
//   usePage(fn, deps)                 page effect inside a gsap.context, reverted on unmount
import { useEffect, useLayoutEffect, useRef, type DependencyList } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { gsap } from 'gsap'
import { boot, enter, leave, pageIntro, scrollToTarget, type PageFn } from './index'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

// The logo's corner and cross paths, cropped to each part (viewBox units of the 1024 mark).
const CORNERS = [
  ['tl', '180 180 276 278', 'M180 180H360V278L456 402V458H402L278 360H180Z'],
  ['tr', '568 180 276 278', 'M844 180H664V278L568 402V458H622L746 360H844Z'],
  ['bl', '180 566 276 278', 'M180 844H360V746L456 622V566H402L278 664H180Z'],
  ['br', '568 566 276 278', 'M844 844H664V746L568 622V566H622L746 664H844Z'],
] as const

function Curtain() {
  return (
    <div id="curtain" aria-hidden="true">
      {CORNERS.map(([q, box, d]) => (
        <div key={q} className={`curtain-q curtain-${q}`}>
          <svg className="curtain-corner" viewBox={box} fill="currentColor">
            <path d={d} />
          </svg>
        </div>
      ))}
      <div className="curtain-mark">
        <svg viewBox="414 414 196 196" fill="currentColor">
          <path d="M494 414H530V494H610V530H530V610H494V530H414V494H494Z" />
        </svg>
      </div>
    </div>
  )
}

// Shared between the click handler and PageReady: whether the curtain is closed and
// waiting for the next page, and which path the engine last set up.
const nav = { pending: false, busy: false, shown: null as string | null }

/** Mount once inside the router, outside the routes. Owns the curtain and intercepts
 *  internal link clicks between transition pages: close the curtain, then navigate. */
export function Engine({ isTransitionPath }: { isTransitionPath: (pathname: string) => boolean }) {
  const navigate = useNavigate()
  const pathFilter = useRef(isTransitionPath)
  pathFilter.current = isTransitionPath

  // Capture phase, so this runs before React Router's Link handler, which skips events
  // that are already defaultPrevented.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || 'noTransition' in a.dataset) return
      const url = new URL(a.href, location.href)
      if (url.origin !== location.origin || url.pathname === location.pathname) return
      if (!pathFilter.current(location.pathname) || !pathFilter.current(url.pathname)) return
      e.preventDefault()
      if (nav.busy) return
      nav.busy = true
      nav.pending = true
      leave().then(() => navigate(url.pathname + url.search + url.hash))
    }
    addEventListener('click', onClick, true)
    return () => removeEventListener('click', onClick, true)
  }, [navigate])

  return <Curtain />
}

/** Rendered after the page component (inside the same Suspense boundary), so it mounts
 *  only once a lazy page has loaded: then the engine boots (first load) or enters. */
export function PageReady() {
  const { pathname, hash } = useLocation()
  useIsoLayoutEffect(() => {
    // Keyed on the path actually shown, so StrictMode's double effect run is a no-op.
    if (nav.shown === pathname) return
    const isFirst = nav.shown === null
    nav.shown = pathname
    if (isFirst) {
      boot()
    } else {
      const transition = nav.pending
      nav.pending = false
      enter({ transition }).finally(() => {
        nav.busy = false
      })
      // A custom router has to move focus itself so screen readers land on the new page.
      document.getElementById('main')?.focus({ preventScroll: true })
    }
    if (hash) requestAnimationFrame(() => scrollToTarget(decodeURIComponent(hash), { immediate: true }))
  }, [pathname])
  return null
}

/** A page effect: runs after the engine has set up the page, inside its own gsap.context,
 *  so every tween and ScrollTrigger it creates is reverted when the component unmounts
 *  (route change included). Return a function to undo anything else (listeners). */
export function usePage(fn: PageFn, deps: DependencyList = []) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    let undo: void | (() => void)
    const c = gsap.context(() => {
      undo = ref.current({ intro: pageIntro() ?? gsap.timeline({ paused: true }), path: location.pathname })
    })
    return () => {
      if (typeof undo === 'function') undo()
      c.revert()
    }
  }, deps)
}
