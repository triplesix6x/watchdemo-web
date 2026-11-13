import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import './home-background.css'

const GhostFibers = lazy(() => import('./GhostFibers/GhostFibers'))

export function HomeBackground() {
  const layer = useRef<HTMLDivElement>(null)
  const [allowed, setAllowed] = useState(false)
  const [activated, setActivated] = useState(false)

  useEffect(() => {
    const media = [
      '(prefers-reduced-motion: reduce)',
      '(prefers-reduced-transparency: reduce)',
      '(prefers-contrast: more)',
    ].map(query => matchMedia(query))
    const update = () => setAllowed(!media.some(query => query.matches))
    update()
    media.forEach(query => query.addEventListener('change', update))
    return () => media.forEach(query => query.removeEventListener('change', update))
  }, [])

  useEffect(() => {
    if (!layer.current) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setActivated(true)
      observer.disconnect()
    })
    observer.observe(layer.current)
    return () => observer.disconnect()
  }, [])

  return <div ref={layer} className="home-background" aria-hidden="true">
    <div className="home-background-effect">
      {allowed && activated && <Suspense fallback={null}>
        <GhostFibers glowColor="#5b97f0" lineColor="#7eb1f7" secondaryColor="#2f6fd2"
          speed={0.22} brightness={1.1} glow={0.65} mouseInteraction pulseOnClick intro={false} dpr={1} />
      </Suspense>}
    </div>
    <div className="home-background-shade" />
  </div>
}
