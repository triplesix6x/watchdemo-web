import { useEffect, useState } from 'react'
import { useLocale } from '../../i18n'
import { maintenanceApi, NOTICE_CHANGED } from './api'
import type { PublicNotice } from './contract'
import './maintenance.css'

/** In-flow sibling after the header; never gates content or steals focus. */
export function MaintenanceBanner() {
  const locale = useLocale()
  const [notice, setNotice] = useState<{ locale: string; notice: PublicNotice } | null>(null)

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
  const current = notice?.locale === locale ? notice.notice : null
  if (!current?.enabled || !current.text) return null
  return <aside className="maintenance-banner" aria-label={locale === 'en' ? 'Site notice' : 'Уведомление сайта'}>
    <p className="maintenance-banner-text">{current.text}</p>
  </aside>
}
