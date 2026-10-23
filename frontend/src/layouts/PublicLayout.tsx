// Chrome of the public site: sticky header (logo, nav, language, sign-in), a mobile menu,
// the page in <main>, and the footer with the channel, contact and current version.
import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu as MenuIcon, X, Send, MessageCircle } from 'lucide-react'
import { LangSwitch, LocalLink, fmt, splitLocale, useT } from '../i18n'
import { useAuth } from '../context/AuthContext'
import { ButtonLink, IconButton, Logo, useFocusTrap } from '../ui'
import { lockScroll } from '../engine'
import { useLatestRelease } from '../lib/useLatestRelease'
import { CONTACT_URL, TELEGRAM_CHANNEL } from '../config'

const NAV = [
  { to: '/download', key: 'download' },
  { to: '/pricing', key: 'pricing' },
  { to: '/changelog', key: 'changelog' },
  { to: '/help', key: 'help' },
] as const

function useCurrentPath() {
  return splitLocale(useLocation().pathname).path
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT()
  const path = useCurrentPath()
  return (
    <>
      {NAV.map((n) => (
        <LocalLink key={n.to} to={n.to} className="nav-link" aria-current={path === n.to ? 'page' : undefined} onClick={onNavigate}>
          {t.nav[n.key]}
        </LocalLink>
      ))}
    </>
  )
}

// The chunks behind «Кабинет» and «Войти», fetched before the click so the next page
// paints without waiting for them.
const preloadCabinet = () => import('../pages/account/Overview')
const preloadLogin = () => import('../pages/auth/Login')

function AccountLink({ block }: { block?: boolean }) {
  const t = useT()
  const { user } = useAuth()
  useEffect(() => {
    if (!user) return
    const id = (window.requestIdleCallback ?? setTimeout)(() => void preloadCabinet())
    return () => (window.cancelIdleCallback ?? clearTimeout)(id)
  }, [user])
  const preload = user ? preloadCabinet : preloadLogin
  // Before the session check finishes this reads "Войти", the same as the prerendered HTML.
  return (
    <ButtonLink to={user ? '/account' : '/login'} variant="soft" block={block} onPointerEnter={() => void preload()} onFocus={() => void preload()}>
      {user ? t.nav.account : t.nav.login}
    </ButtonLink>
  )
}

function MobileMenu({ onClose }: { onClose: () => void }) {
  const t = useT()
  const ref = useFocusTrap(onClose)
  useEffect(() => lockScroll(), [])
  return (
    <div ref={ref} id="mobile-menu" className="mobile-menu" role="dialog" aria-modal="true" aria-label={t.a11y.mainNav}>
      <nav aria-label={t.a11y.mainNav}>
        <NavLinks onNavigate={onClose} />
      </nav>
      <div className="mobile-menu-foot">
        <LangSwitch />
        <AccountLink />
      </div>
    </div>
  )
}

function Footer() {
  const t = useT()
  const version = useLatestRelease().data?.version
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <LocalLink to="/" className="brand" aria-label={t.a11y.home}>
              <Logo size={20} label={null} />
              <span>WatchDemo</span>
            </LocalLink>
            <p>{t.footer.tagline}</p>
          </div>
          <div className="footer-col">
            <NavLinksFooter />
          </div>
          <div className="footer-col">
            <a className="footer-link" href={TELEGRAM_CHANNEL} target="_blank" rel="noopener noreferrer">
              <Send size={15} aria-hidden />
              <span>
                {t.footer.channel} <small>{t.footer.channelHint}</small>
              </span>
            </a>
            <a className="footer-link" href={CONTACT_URL} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={15} aria-hidden />
              {t.footer.contact}
            </a>
          </div>
        </div>
        <div className="footer-bottom">
          <span className="num">
            {fmt(t.footer.rights, { year: new Date().getFullYear() })}
            {version && <> · {fmt(t.footer.version, { version })}</>}
          </span>
          <LangSwitch />
        </div>
      </div>
    </footer>
  )
}

function NavLinksFooter() {
  const t = useT()
  return (
    <>
      {NAV.map((n) => (
        <LocalLink key={n.to} to={n.to} className="footer-link">
          {t.nav[n.key]}
        </LocalLink>
      ))}
    </>
  )
}

export default function PublicLayout() {
  const t = useT()
  const path = useCurrentPath()
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [path])

  return (
    <>
      <a className="skip-link" href="#main">
        {t.a11y.skipToContent}
      </a>
      <header className="site-header">
        <div className="container site-header-inner">
          <LocalLink to="/" className="brand" aria-label={t.a11y.home}>
            <Logo size={20} label={null} />
            <span aria-hidden="true">WatchDemo</span>
          </LocalLink>
          <nav className="site-nav" aria-label={t.a11y.mainNav}>
            <NavLinks />
          </nav>
          <div className="site-actions">
            <LangSwitch />
            <AccountLink />
          </div>
          <IconButton
            className="menu-toggle"
            label={menuOpen ? t.a11y.closeMenu : t.a11y.openMenu}
            icon={menuOpen ? <X size={20} /> : <MenuIcon size={20} />}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((o) => !o)}
          />
        </div>
        {menuOpen && <MobileMenu onClose={() => setMenuOpen(false)} />}
      </header>
      <main id="main" tabIndex={-1} className="site-main">
        <Outlet />
      </main>
      <Footer />
    </>
  )
}
