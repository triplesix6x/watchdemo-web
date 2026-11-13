import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useLocale } from '../../i18n'
import { maintenanceApi, NOTICE_CHANGED } from './api'
import type { PublicNotice } from './contract'
import './maintenance.css'

/** In-flow sibling after the header; never gates content or steals focus. */
export function MaintenanceBanner() {
  const locale = useLocale()
  const [notice, setNotice] = useState<{ locale: string; notice: PublicNotice } | null>(null)
  const [distance, setDistance] = useState(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const messageRef = useRef<HTMLSpanElement>(null)
  const current = notice?.locale === locale ? notice.notice : null

  useEffect(() => {
    const viewport = viewportRef.current
    const message = messageRef.current
    if (!viewport || !message) return
    const measure = () => setDistance(Math.max(viewport.clientWidth, message.scrollWidth) + 48)
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(message)
    measure()
    return () => observer.disconnect()
  }, [current?.text, current?.enabled])

  useEffect(() => {
    let active = true
    let pending = false
    const refresh = async () => {
      if (!active || pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        const next = await maintenanceApi.publicNotice(locale)
        if (active) setNotice({ locale, notice: next })
      } catch {
        // Initial failure stays invisible; later failures preserve the last notice.
        // Site content and navigation must remain available in either case.
      } finally {
        pending = false
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 60_000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(NOTICE_CHANGED, onVisible)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(NOTICE_CHANGED, onVisible)
    }
  }, [locale])

  // No empty loading band; do not show the previous locale while switching.
  if (!current?.enabled || !current.text) return null
  const tickerStyle: CSSProperties & Record<'--notice-distance' | '--notice-duration', string> = {
    '--notice-distance': `${distance}px`,
    '--notice-duration': `${Math.max(24, distance / 28)}s`,
  }
  return <aside className="maintenance-banner" aria-label={locale === 'en' ? 'Site notice' : 'Уведомление сайта'}>
    <span className="maintenance-warning" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9v5m0 3v.1" strokeLinecap="round"/></svg>
    </span>
    <div className="maintenance-viewport" ref={viewportRef}>
      <p className="maintenance-banner-text">{current.text}</p>
      <div className="maintenance-track" aria-hidden="true" style={tickerStyle}>
        <span className="maintenance-ticker-item"><span ref={messageRef}>{current.text}</span></span>
        <span className="maintenance-ticker-item"><span>{current.text}</span></span>
      </div>
    </div>
  </aside>
}
