import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { hasRole, type Role } from '../api/types'
import { splitLocale, localizedPath, useT } from '../i18n'
import { DelayedReveal, Skeleton } from '../ui'

/** The shell's content while the session or the page chunk loads: a page-head skeleton,
 *  shown after 300 ms so a fast restore never flashes it. */
export function ShellWait() {
  const t = useT()
  return (
    <DelayedReveal className="shell-wait">
      <span className="sr-only" role="status">
        {t.state.loading}
      </span>
      <Skeleton width="12rem" height="1.75rem" />
      <Skeleton width="min(20rem, 80%)" height="0.875rem" />
      <Skeleton height="9rem" radius="var(--r-xl)" />
    </DelayedReveal>
  )
}

/** Gate for a cabinet or admin page inside the app shell. While the session is restored
 *  from the refresh cookie the shell is already up and this shows ShellWait. No session:
 *  /login?next=<here>. A role below `minRole`: back to the cabinet. */
export default function ProtectedRoute({ minRole = 'user', children }: { minRole?: Role; children: ReactNode }) {
  const { user, isLoading } = useAuth()
  const { pathname, search } = useLocation()
  const { locale } = splitLocale(pathname)

  if (isLoading) return <ShellWait />
  if (!user) return <Navigate to={`${localizedPath('/login', locale)}?next=${encodeURIComponent(pathname + search)}`} replace />
  if (!hasRole(user.role, minRole)) return <Navigate to={localizedPath('/account', locale)} replace />
  return <>{children}</>
}
