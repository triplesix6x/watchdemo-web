import { Fragment, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { ArrowLeft, BadgeCheck, FlaskConical, KeyRound, LogOut, MonitorSmartphone, MoreHorizontal, Power, ShieldHalf, UserX } from 'lucide-react'
import { adminApi } from '../../api/endpoints'
import type { AdminUserDetail } from '../../api/types'
import { useAuth } from '../../context/AuthContext'
import { Head } from '../../head/Head'
import { LocalLink, fmt, useLocale, useT } from '../../i18n'
import { formatDate, formatDateTime } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { deviceName, parseDevice } from '../../lib/userAgent'
import { ConfirmModal, CopyButton, DelayedReveal, EmptyState, IconButton, LoadError, Menu, MenuItem, MenuSeparator, PageHead, Pill, RoleBadge, Section, Skeleton } from '../../ui'
import { canOnUser, type UserAction } from '../../features/admin/access'
import { AuditTable } from '../../features/admin/parts'
import { RoleDialog } from '../../features/admin/RoleDialog'
import { SubscriptionCard, toSummary } from '../../features/admin/SubscriptionCard'
import { useAdminAction, useAdminDict, type AdminDict } from '../../features/admin/useAdmin'
import '../../features/admin/admin.css'

/** Confirmations this page can ask for; one at a time. */
type Confirm = 'deactivate' | 'signOut' | 'reset' | 'revoke' | null

export default function AdminUserDetail() {
  const { id = '' } = useParams()
  const p = useAdminDict()
  const t = useT()
  const { user: me } = useAuth()
  const res = useAsync(() => adminApi.user(id), [id])
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [roleOpen, setRoleOpen] = useState(false)
  const { run, busy } = useAdminAction()
  const u = res.data

  /** Apply a change the server confirmed, then refetch: only the server can fill in the
   *  history card and the sessions list. */
  const applied = (edit: (u: AdminUserDetail) => AdminUserDetail) => {
    res.mutate(edit)
    res.reload()
  }

  if (res.error && !res.data)
    return (
      <>
        <Head title={p.users.title} noindex />
        <BackLink p={p} />
        {res.error.status === 404 ? (
          <EmptyState className="card" icon={<UserX size={18} />} title={p.user.notFound} text={p.user.notFoundText} action={<LocalLink to="/admin/users" className="link">{p.user.back}</LocalLink>} />
        ) : (
          <LoadError text={res.error.message} onRetry={res.reload} />
        )}
      </>
    )
  if (!u)
    return (
      <>
        <Head title={p.users.title} noindex />
        <BackLink p={p} />
        <DelayedReveal className="adm-detail-skel">
          <Skeleton width="14rem" height="1.75rem" />
          <Skeleton height="9rem" radius="var(--r-2xl)" />
          <Skeleton height="9rem" radius="var(--r-2xl)" />
        </DelayedReveal>
      </>
    )

  const allowed = (a: UserAction) => canOnUser(me && { id: me.id, role: me.role }, u, a)
  const name = u.username

  const setActive = async (is_active: boolean) => {
    const r = await run('active', () => adminApi.setActive(u.id, is_active), fmt(is_active ? p.user.activated : p.user.deactivated, { name }))
    setConfirm(null)
    if (r) applied((x) => ({ ...x, is_active: r.is_active, sessions: r.is_active ? x.sessions : [] }))
  }
  const setBeta = async (on: boolean) => {
    res.mutate((x) => ({ ...x, is_beta_tester: on }))
    const r = await run('beta', () => adminApi.setBeta(u.id, on), fmt(on ? p.user.betaOnDone : p.user.betaOffDone, { name }))
    if (r) applied((x) => ({ ...x, is_beta_tester: r.is_beta_tester }))
    else res.mutate((x) => ({ ...x, is_beta_tester: !on }))
  }
  const verify = async () => {
    const r = await run('verify', () => adminApi.verify(u.id), fmt(p.user.verifiedDone, { name }))
    if (r) applied((x) => ({ ...x, is_verified: r.is_verified }))
  }
  const sendReset = async () => {
    const r = await run('reset', () => adminApi.sendPasswordReset(u.id), fmt(p.user.resetDone, { email: u.email }))
    setConfirm(null)
    if (r) applied((x) => x)
  }
  const signOut = async () => {
    const ok = await run('signOut', () => adminApi.revokeSessions(u.id).then(() => true), fmt(p.user.signedOut, { name }))
    setConfirm(null)
    if (ok) applied((x) => ({ ...x, sessions: [] }))
  }

  // Two groups in the menu: account state, then the heavier actions.
  const menuItems: { key: string; show: boolean; group: 0 | 1; node: ReactNode }[] = [
    {
      key: 'active',
      group: 0,
      show: allowed('setActive'),
      node: u.is_active ? (
        <MenuItem danger icon={<Power size={15} />} onSelect={() => setConfirm('deactivate')}>
          {p.user.deactivate}
        </MenuItem>
      ) : (
        <MenuItem icon={<Power size={15} />} onSelect={() => setActive(true)}>
          {p.user.activate}
        </MenuItem>
      ),
    },
    {
      key: 'beta',
      group: 0,
      show: allowed('beta'),
      node: (
        <MenuItem icon={<FlaskConical size={15} />} onSelect={() => setBeta(!u.is_beta_tester)}>
          {u.is_beta_tester ? p.user.betaOff : p.user.betaOn}
        </MenuItem>
      ),
    },
    {
      key: 'verify',
      group: 0,
      show: allowed('verify') && !u.is_verified,
      node: (
        <MenuItem icon={<BadgeCheck size={15} />} onSelect={verify}>
          {p.user.verify}
        </MenuItem>
      ),
    },
    {
      key: 'reset',
      group: 0,
      show: allowed('passwordReset') && u.is_active,
      node: (
        <MenuItem icon={<KeyRound size={15} />} onSelect={() => setConfirm('reset')}>
          {p.user.reset}
        </MenuItem>
      ),
    },
    {
      key: 'signOut',
      group: 1,
      show: allowed('revokeSessions'),
      node: (
        <MenuItem danger icon={<LogOut size={15} />} onSelect={() => setConfirm('signOut')}>
          {p.user.signOutAll}
        </MenuItem>
      ),
    },
    {
      key: 'role',
      group: 1,
      show: allowed('role'),
      node: (
        <MenuItem icon={<ShieldHalf size={15} />} onSelect={() => setRoleOpen(true)}>
          {p.user.changeRole}
        </MenuItem>
      ),
    },
  ]
  const visible = menuItems.filter((m) => m.show)
  const groups = [0, 1].map((g) => visible.filter((m) => m.group === g)).filter((g) => g.length)
  const canSub = allowed('subscription')

  const confirms: Record<Exclude<Confirm, null>, { title: string; text: string; label: string; danger: boolean; go: () => void }> = {
    deactivate: { title: p.user.deactivateTitle, text: fmt(p.user.deactivateText, { name }), label: p.user.deactivate, danger: true, go: () => setActive(false) },
    signOut: { title: p.user.signOutTitle, text: fmt(p.user.signOutText, { name }), label: p.user.signOutAll, danger: true, go: signOut },
    reset: { title: p.user.resetTitle, text: fmt(p.user.resetText, { email: u.email }), label: p.user.resetConfirm, danger: false, go: sendReset },
    revoke: { title: p.user.revokeTitle, text: fmt(p.user.revokeText, { name }), label: p.user.revoke, danger: true, go: () => revoke() },
  }
  const revoke = async () => {
    const r = await run('revoke', () => adminApi.revokeSubscription(u.id), fmt(p.user.revoked, { name }))
    setConfirm(null)
    if (r) applied((x) => ({ ...x, subscription: toSummary(r) }))
  }
  const c = confirm && confirms[confirm]

  return (
    <>
      <BackLink p={p} />
      <PageHead
        title={`@${name}`}
        className="adm-user-head"
        lead={
          <span className="adm-user-pills">
            <RoleBadge role={u.role} />
            {!u.is_active && <Pill tone="danger">{p.user.activeOff}</Pill>}
            {!u.is_verified && <Pill tone="warning">{p.users.unverified}</Pill>}
            {u.is_beta_tester && <Pill tone="brand">{p.users.beta}</Pill>}
          </span>
        }
        aside={
          visible.length > 0 && (
            <Menu label={p.user.actions} trigger={(tp) => <IconButton {...tp} label={p.user.actions} icon={<MoreHorizontal size={18} />} disabled={!!busy} />}>
              {groups.map((g, i) => (
                <Fragment key={i}>
                  {i > 0 && <MenuSeparator />}
                  {g.map((m) => (
                    <Fragment key={m.key}>{m.node}</Fragment>
                  ))}
                </Fragment>
              ))}
            </Menu>
          )
        }
      />

      {me?.role === 'support' && <p className="adm-note">{p.user.readOnly}</p>}

      <div className="adm-detail-grid">
        <Facts u={u} p={p} />
        <SubscriptionCard u={u} canEdit={canSub} busy={busy} run={run} onChanged={(s) => applied((x) => ({ ...x, subscription: s }))} onRevoke={() => setConfirm('revoke')} />
        <Sessions u={u} p={p} />
        {me?.role === 'admin' && (
          <Section title={p.user.history} className="adm-section adm-span-2">
            {u.audit.length ? <AuditTable items={u.audit} showTarget={false} /> : <p className="t-muted t-s">{p.user.historyEmpty}</p>}
          </Section>
        )}
      </div>

      {c && (
        <ConfirmModal
          open
          title={c.title}
          message={c.text}
          confirmLabel={c.label}
          variant={c.danger ? 'danger' : 'default'}
          busy={!!busy}
          onConfirm={c.go}
          onCancel={() => setConfirm(null)}
        />
      )}
      {roleOpen && (
        <RoleDialog
          u={u}
          busy={busy === 'role'}
          onClose={() => setRoleOpen(false)}
          onSave={async (role) => {
            const r = await run('role', () => adminApi.setRole(u.id, role), fmt(p.user.roleDone, { name, role: t.role[role] }))
            if (r) {
              setRoleOpen(false)
              applied((x) => ({ ...x, role: r.role }))
            }
          }}
        />
      )}
    </>
  )
}

function BackLink({ p }: { p: AdminDict }) {
  return (
    <LocalLink to="/admin/users" className="adm-back">
      <ArrowLeft size={14} aria-hidden />
      {p.user.back}
    </LocalLink>
  )
}

function Facts({ u, p }: { u: AdminUserDetail; p: AdminDict }) {
  const locale = useLocale()
  const rows: [string, ReactNode][] = [
    [
      p.user.id,
      <span className="adm-id">
        <code>{u.id}</code>
        <CopyButton icon text={u.id} label={p.user.copyId} />
      </span>,
    ],
    [p.user.email, u.email],
    [p.user.role, <RoleBadge role={u.role} />],
    [p.user.joined, u.created_at ? formatDate(u.created_at, locale) : '·'],
    [p.user.verified, u.is_verified ? p.user.on : p.user.off],
    [p.user.active, u.is_active ? p.user.activeOn : p.user.activeOff],
    [p.user.beta, u.is_beta_tester ? p.user.on : p.user.off],
  ]
  return (
    <Section title={p.user.facts} className="adm-section">
      <dl className="adm-facts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}

function Sessions({ u, p }: { u: AdminUserDetail; p: AdminDict }) {
  const locale = useLocale()
  const t = useT()
  return (
    <Section
      title={
        <>
          {p.user.sessions} <span className="t-muted num">{u.sessions.length}</span>
        </>
      }
      className="adm-section adm-span-2"
    >
      {u.sessions.length === 0 ? (
        <p className="t-muted t-s">{p.user.sessionsEmpty}</p>
      ) : (
        <ul className="adm-list">
          {u.sessions.map((s) => (
            <li key={s.id} className="adm-list-row">
              <MonitorSmartphone size={16} aria-hidden className="t-muted" />
              <span className="adm-list-main">{deviceName(parseDevice(s.device_info), t)}</span>
              <span className="adm-list-meta num">{s.ip_address ?? '·'}</span>
              <span className="adm-list-meta num">
                {fmt(p.user.lastUsed, { date: formatDateTime(s.last_used_at, locale) })}
                {s.created_at && ` · ${fmt(p.user.since, { date: formatDate(s.created_at, locale) })}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
