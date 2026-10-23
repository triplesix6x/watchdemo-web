// Every route of the site, in one table. The client router, the server render and the
// prerender script all read it. Paths are unprefixed; each route also exists under /en.
// To add a page: create src/pages/<...>.tsx with a default export and add one row here.
import { Fragment, lazy, Suspense, type ComponentType } from 'react'
import { matchPath, Navigate, Route, Routes } from 'react-router-dom'
import type { Role } from '../api/types'
import { LOCALES, localizedPath, splitLocale, useLocale, useT, type Locale } from '../i18n'
import { PageReady } from '../engine/react'
import { DelayedReveal, LogoLoader } from '../ui'
import PublicLayout from '../layouts/PublicLayout'
import AppShell from '../layouts/AppShell'
import ProtectedRoute, { ShellWait } from './ProtectedRoute'
// Public pages are eager: they are prerendered and hydrate without waiting for a chunk.
import Home from '../pages/Home'
import Download from '../pages/Download'
import Pricing from '../pages/Pricing'
import Changelog from '../pages/Changelog'
import Help from '../pages/Help'
import NotFound from '../pages/NotFound'

export type RouteDef = {
  path: string
  Page: ComponentType
  layout: 'public' | 'app'
  /** Rendered to static HTML at build time (both locales). */
  prerender?: boolean
  /** Needs a session; cabinet routes are 'user', admin routes support and up. */
  minRole?: Role
  /** Starts loading a lazy page's chunk. */
  preload?: () => Promise<unknown>
}

/** A lazy page that can start loading before it renders (while the session resolves). */
function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  return { Page: lazy(load), preload: load }
}

export const ROUTES: RouteDef[] = [
  { path: '/', Page: Home, layout: 'public', prerender: true },
  { path: '/download', Page: Download, layout: 'public', prerender: true },
  { path: '/pricing', Page: Pricing, layout: 'public', prerender: true },
  { path: '/changelog', Page: Changelog, layout: 'public', prerender: true },
  { path: '/help', Page: Help, layout: 'public', prerender: true },

  { path: '/login', ...lazyPage(() => import('../pages/auth/Login')), layout: 'public' },
  { path: '/register', ...lazyPage(() => import('../pages/auth/Register')), layout: 'public' },
  { path: '/forgot-password', ...lazyPage(() => import('../pages/auth/ForgotPassword')), layout: 'public' },
  { path: '/reset-password', ...lazyPage(() => import('../pages/auth/ResetPassword')), layout: 'public' },
  { path: '/verify-email', ...lazyPage(() => import('../pages/auth/VerifyEmail')), layout: 'public' },
  { path: '/resend-verification', ...lazyPage(() => import('../pages/auth/ResendVerification')), layout: 'public' },
  { path: '/confirm-email-change', ...lazyPage(() => import('../pages/auth/ConfirmEmailChange')), layout: 'public' },

  { path: '/account', ...lazyPage(() => import('../pages/account/Overview')), layout: 'app', minRole: 'user' },
  { path: '/account/security', ...lazyPage(() => import('../pages/account/Security')), layout: 'app', minRole: 'user' },
  { path: '/account/profile', ...lazyPage(() => import('../pages/account/Profile')), layout: 'app', minRole: 'user' },

  { path: '/admin', ...lazyPage(() => import('../pages/admin/Overview')), layout: 'app', minRole: 'support' },
  { path: '/admin/users', ...lazyPage(() => import('../pages/admin/Users')), layout: 'app', minRole: 'support' },
  { path: '/admin/users/:id', ...lazyPage(() => import('../pages/admin/UserDetail')), layout: 'app', minRole: 'support' },
  { path: '/admin/releases', ...lazyPage(() => import('../pages/admin/Releases')), layout: 'app', minRole: 'moderator' },
  { path: '/admin/audit', ...lazyPage(() => import('../pages/admin/Audit')), layout: 'app', minRole: 'admin' },
]

/** Old URLs the desktop app and old emails still open. */
export const REDIRECTS: { from: string; to: string }[] = [
  { from: '/dashboard', to: '/account' },
  { from: '/sessions', to: '/account/security' },
]

/** Dev and mock builds only: the component showcase. Dropped from production bundles. */
const UiShowcase = import.meta.env.DEV || __MOCK__ ? lazy(() => import('../pages/dev/UiShowcase')) : null

export const NOT_FOUND: RouteDef = { path: '*', Page: NotFound, layout: 'public', prerender: true }

/** Unprefixed paths rendered to HTML at build time (the 404 is written separately). */
export const PRERENDER_PATHS = ROUTES.filter((r) => r.prerender).map((r) => r.path)

const spaPatterns = [...ROUTES.filter((r) => !r.prerender).map((r) => r.path), ...REDIRECTS.map((r) => r.from), '/__ui']
/** The curtain transition runs between prerendered public pages (and the 404). */
export function isTransitionPath(pathname: string): boolean {
  const { path } = splitLocale(pathname)
  return !spaPatterns.some((p) => matchPath(p, path))
}

function RouteFallback() {
  const t = useT()
  return (
    <DelayedReveal className="route-wait">
      <LogoLoader label={t.state.loading} />
    </DelayedReveal>
  )
}

function RouteView({ def }: { def: RouteDef }) {
  const page = (
    <>
      <def.Page />
      <PageReady />
    </>
  )
  if (!def.minRole)
    return <Suspense fallback={<RouteFallback />}>{page}</Suspense>
  // The chunk loads alongside the session check instead of after it. import() is
  // idempotent, so calling it on every render costs nothing.
  def.preload?.()
  return (
    <ProtectedRoute minRole={def.minRole}>
      <Suspense fallback={<ShellWait />}>{page}</Suspense>
    </ProtectedRoute>
  )
}

function Redirect({ to }: { to: string }) {
  return <Navigate to={localizedPath(to, useLocale())} replace />
}

const at = (path: string, locale: Locale) => localizedPath(path, locale)

export function AppRoutes() {
  return (
    <Routes>
      {LOCALES.map((l) => (
        <Fragment key={l}>
          <Route element={<PublicLayout />}>
            {ROUTES.filter((r) => r.layout === 'public').map((r) => (
              <Route key={r.path} path={at(r.path, l)} element={<RouteView def={r} />} />
            ))}
          </Route>
          <Route element={<AppShell />}>
            {ROUTES.filter((r) => r.layout === 'app').map((r) => (
              <Route key={r.path} path={at(r.path, l)} element={<RouteView def={r} />} />
            ))}
          </Route>
          {REDIRECTS.map((r) => (
            <Route key={r.from} path={at(r.from, l)} element={<Redirect to={r.to} />} />
          ))}
        </Fragment>
      ))}
      {UiShowcase && <Route path="/__ui" element={<Suspense fallback={null}><UiShowcase /><PageReady /></Suspense>} />}
      <Route element={<PublicLayout />}>
        <Route path="*" element={<RouteView def={NOT_FOUND} />} />
      </Route>
    </Routes>
  )
}
