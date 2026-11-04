import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowDown, Pause } from 'lucide-react'
import { LocalLink, useDict } from '../../i18n'
import './focus.css'

const Topography = lazy(() => import('./terrain/Topography'))
const ru = {
  title: 'Разбор матча.\nВсё в одном месте.',
  lead: 'Библиотека демок, моменты, свои наборы и 2D-реплей. Соберите разбор в WatchDemo и смотрите демо прямо в CS2.',
  download: 'Скачать для Windows',
  how: 'Посмотреть возможности',
  platform: 'Windows 10/11',
  alt: 'WatchDemo: библиотека матчей Falcons против Spirit, свои наборы и кнопка просмотра демо в CS2',
  imageLabel: 'Библиотека и наборы WatchDemo',
  imageHint: 'Прокрутите изображение по горизонтали.',
  mouse: 'Проведите курсором по рельефу. Нажмите, чтобы пустить волну.',
  touch: 'Коснитесь рельефа, чтобы пустить волну.',
  static: 'Статичный фон',
}
const en: typeof ru = {
  title: 'Match review.\nEverything in one place.',
  lead: 'Your demo library, moments, custom sets and 2D replay. Bring your review together in WatchDemo and watch demos directly in CS2.',
  download: 'Download for Windows',
  how: 'Explore the tools',
  platform: 'Windows 10/11',
  alt: 'WatchDemo: Falcons versus Spirit match library, custom sets and the button to watch a demo in CS2',
  imageLabel: 'Your WatchDemo library and sets',
  imageHint: 'Scroll the image horizontally.',
  mouse: 'Move over the terrain. Click to send out a wave.',
  touch: 'Tap the terrain to send out a wave.',
  static: 'Static background',
}

/** The approved first screen. Its decorative renderer shares the site's GSAP ticker. */
export function FocusHero({ version }: { version?: string }) {
  const p = useDict({ ru, en })
  const scene = useRef<HTMLElement>(null)
  const product = useRef<HTMLPictureElement>(null)
  const [motionAllowed, setMotionAllowed] = useState(false)
  const [paused, setPaused] = useState(false)
  const [onScreen, setOnScreen] = useState(false)

  useEffect(() => {
    const preferences = [
      matchMedia('(prefers-reduced-motion: reduce)'),
      matchMedia('(prefers-reduced-transparency: reduce)'),
      matchMedia('(prefers-contrast: more)'),
    ]
    const update = () => setMotionAllowed(!preferences.some(preference => preference.matches))
    update()
    preferences.forEach(preference => preference.addEventListener('change', update))
    return () => preferences.forEach(preference => preference.removeEventListener('change', update))
  }, [])

  useEffect(() => {
    const element = scene.current
    if (!element) return
    // Defer the WebGL chunk for visits that start at an anchor below the hero.
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setOnScreen(true)
        observer.disconnect()
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = scene.current
    const frameElement = product.current
    if (!element || !frameElement) return
    const placeLight = () => {
      const area = element.getBoundingClientRect()
      const frame = frameElement.getBoundingClientRect()
      const visibleWidth = Math.min(frame.width, area.right - frame.left)
      element.style.setProperty('--stage-light-x', `${frame.left - area.left + visibleWidth * .52}px`)
      element.style.setProperty('--stage-light-y', `${frame.bottom - area.top + 24}px`)
      element.style.setProperty('--stage-light-width', `${Math.max(visibleWidth * .85, 260)}px`)
      element.style.setProperty('--stage-light-height', `${Math.max(frame.height * .55, 160)}px`)
    }
    const observer = new ResizeObserver(placeLight)
    observer.observe(element)
    observer.observe(frameElement)
    placeLight()
    return () => observer.disconnect()
  }, [])

  const animated = motionAllowed && !paused && onScreen
  return (
    <section ref={scene} className="focus-hero" aria-labelledby="focus-title">
      <div className={`focus-backdrop${animated ? ' is-live' : ''}`} aria-hidden="true">
        <div className="focus-contours" />
        {animated && (
          <Suspense fallback={null}>
            <Topography
              color="#0297DE" accentColor="#FC734D" lineCount={22} lineWidth={1.15}
              elevation={.85} foreground={.2} tilt={32} speed={.055} morph={.04}
              glow={.12} depthOfField={0} fog={.25} brightness={1.15}
              mouseInteraction hoverEffect="lift" mouseRadius={1.25} mouseStrength={.95}
              trail={.4} parallax={.15} clickEffect="pulse" markers="none" glitch={0}
              intro={false} dpr={.85}
            />
          </Suspense>
        )}
      </div>
      <div className="focus-layout">
        <div className="focus-copy">
          <h1 id="focus-title">{p.title}</h1>
          <p className="focus-lead">{p.lead}</p>
          <div className="focus-actions">
            <LocalLink to="/download" className="focus-primary">{p.download}<ArrowDown size={19} aria-hidden="true" /></LocalLink>
            <a href="#focus-cs2" className="focus-secondary">{p.how}</a>
          </div>
          <p className="focus-platform num">{p.platform}{version && <> · v{version}</>}</p>
        </div>
        <div className="focus-product-area">
          <figure className="focus-product" tabIndex={0} aria-label={`${p.imageLabel}. ${p.imageHint}`}>
            <picture ref={product}>
              <source media="(max-width: 767.98px)" srcSet="/focus/app-home-mobile.webp" />
              <img src="/focus/app-home.webp" width={1280} height={800} alt={p.alt} />
            </picture>
            <figcaption>{p.imageLabel}<span className="focus-image-hint">. {p.imageHint}</span></figcaption>
          </figure>
        </div>
      </div>
      <div className="focus-bottom">
        <p><span className="focus-mouse-hint">{p.mouse}</span><span className="focus-touch-hint">{p.touch}</span></p>
        <button type="button" className="focus-static" disabled={!motionAllowed} aria-pressed={!motionAllowed || paused} onClick={() => setPaused(value => !value)}>
          <Pause size={13} aria-hidden="true" />{p.static}
        </button>
      </div>
    </section>
  )
}
