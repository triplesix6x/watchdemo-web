// Cabinet and admin, modelled on the desktop app: a title bar on the frame (logo, account
// menu), a sidebar island and a content island. Sections come from SHELL_NAV, filtered by
// role, so a new admin page is one line here plus its route. The shell renders at once,
// while the session is still being restored; each page waits behind its ProtectedRoute.
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Gauge, Shield, UserRound, Users, Package, ScrollText, LayoutDashboard, LogOut, Globe, type LucideIcon } from 'lucide-react'
import { LangSwitch, LocalLink, splitLocale, useLp, useT } from '../i18n'
import { useAuth } from '../context/AuthContext'
import { hasRole, type Role } from '../api/types'
import { Island, Logo, Menu, MenuItem, MenuSeparator, MenuLabel } from '../ui'
import type { Dict } from '../i18n/ru'

type NavItem = { to: string; label: (t: Dict) => string; icon: LucideIcon; minRole: Role; end?: boolean }
type NavGroup = { title: (t: Dict) => string; items: NavItem[] }

export const SHELL_NAV: NavGroup[] = [
  {
    title: (t) => t.shell.cabinet,
    items: [
      { to: '/account', label: (t) => t.shell.overview, icon: Gauge, minRole: 'user', end: true },
      { to: '/account/security', label: (t) => t.shell.security, icon: Shield, minRole: 'user' },
      { to: '/account/profile', label: (t) => t.shell.profile, icon: UserRound, minRole: 'user' },
    ],
  },
  {
    title: (t) => t.shell.admin,
    items: [
      { to: '/admin', label: (t) => t.shell.overview, icon: LayoutDashboard, minRole: 'support', end: true },
      { to: '/admin/users', label: (t) => t.shell.users, icon: Users, minRole: 'support' },
      { to: '/admin/releases', label: (t) => t.shell.releases, icon: Package, minRole: 'moderator' },
      { to: '/admin/audit', label: (t) => t.shell.audit, icon: ScrollText, minRole: 'admin' },
    ],
  },
]

function Sidebar() {
  const t = useT()
  const { user, isLoading } = useAuth()
  const { path } = splitLocale(useLocation().pathname)
  // Every signed-in role has the cabinet, so it shows while the session is restored.
  const role = isLoading ? 'user' : user?.role
  const groups = SHELL_NAV.map((g) => ({ ...g, items: g.items.filter((i) => hasRole(role, i.minRole)) })).filter((g) => g.items.length)
  return (
    <Island as="aside" className="shell-side">
      <nav aria-label={t.a11y.sections}>
        {groups.map((g) => (
          <div key={g.title(t)} className="shell-group">
            <p className="shell-group-title">{g.title(t)}</p>
            {g.items.map((i) => {
              const current = i.end ? path === i.to : path === i.to || path.startsWith(i.to + '/')
              const Icon = i.icon
              return (
                <LocalLink key={i.to} to={i.to} className="list-row list-row-hover" aria-current={current ? 'page' : undefined}>
                  <Icon size={16} />
                  <span>{i.label(t)}</span>
                </LocalLink>
              )
            })}
          </div>
        ))}
      </nav>
    </Island>
  )
}

function AccountMenu() {
  const t = useT()
  const lp = useLp()
  const navigate = useNavigate()
  const { user, isLoading, logout } = useAuth()
  if (isLoading) return <span className="account-btn" aria-hidden="true"><span className="avatar" /></span>
  if (!user) return null
  return (
    <Menu
      label={t.a11y.userMenu}
      trigger={(p) => (
        <button type="button" className="account-btn press" {...p}>
          <span className="avatar" aria-hidden="true">
            {user.username.slice(0, 1)}
          </span>
          <span className="account-name">{user.username}</span>
          <span className="sr-only">{t.a11y.userMenu}</span>
        </button>
      )}
    >
      <MenuLabel>{user.email}</MenuLabel>
      <MenuItem to="/account" icon={<Gauge size={15} />}>
        {t.shell.cabinet}
      </MenuItem>
      {hasRole(user.role, 'support') && (
        <MenuItem to="/admin" icon={<LayoutDashboard size={15} />}>
          {t.shell.admin}
        </MenuItem>
      )}
      <MenuItem to="/" icon={<Globe size={15} />}>
        {t.shell.toSite}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<LogOut size={15} />}
        onSelect={async () => {
          await logout()
          navigate(lp('/'))
        }}
      >
        {t.shell.signOut}
      </MenuItem>
    </Menu>
  )
}

export default function AppShell() {
  const t = useT()
  return (
    <div className="shell app-frame">
      <a className="skip-link" href="#main">
        {t.a11y.skipToContent}
      </a>
      <header className="shell-bar">
        <LocalLink to="/" className="brand" aria-label={t.a11y.home}>
          <Logo size={17} label={null} />
          <span aria-hidden="true">WatchDemo</span>
        </LocalLink>
        <div className="shell-spacer" />
        <LangSwitch />
        <AccountMenu />
      </header>
      <div className="shell-body">
        <Sidebar />
        <Island as="main" id="main" tabIndex={-1} className="shell-main">
          <Outlet />
        </Island>
      </div>
    </div>
  )
}
