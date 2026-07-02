import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import type { AdminUserDetail } from '../../types'
import { fmtDate, formatDetails, RoleBadge, TierBadge, YesNo } from './shared'

const ROLE_LEVEL: Record<string, number> = { user: 0, support: 1, moderator: 2, admin: 3 }
const ROLES = ['user', 'support', 'moderator', 'admin'] as const
const TIERS = ['basic', 'plus', 'pro'] as const

const selectStyle: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 5,
  padding: '0.4rem 0.6rem',
  fontSize: '0.85rem',
}

export default function UserDetail() {
  const { id = '' } = useParams()
  const { user: me } = useAuth()
  const myLevel = ROLE_LEVEL[me?.role ?? 'user'] ?? 0
  const canModerate = myLevel >= ROLE_LEVEL.moderator
  const canAdmin = myLevel >= ROLE_LEVEL.admin

  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)

  const [role, setRole] = useState('user')
  const [tier, setTier] = useState('plus')
  const [expiresAt, setExpiresAt] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const d = await api.get<AdminUserDetail>(`/admin/users/${id}`)
      setDetail(d)
      setRole(d.role)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const runAction = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true)
    setMsg('')
    setActionError('')
    try {
      await fn()
      setMsg(okMsg)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = () => {
    if (!detail) return
    if (detail.is_active && !confirm(`Deactivate @${detail.username}? This logs them out.`)) return
    runAction(
      () => api.patch(`/admin/users/${id}/active`, { is_active: !detail.is_active }),
      detail.is_active ? 'User deactivated' : 'User reactivated',
    )
  }

  const changeRole = () =>
    runAction(() => api.post('/admin/users/role', { user_id: id, role }), `Role set to ${role}`)

  const grantSub = () =>
    runAction(
      () =>
        api.post('/admin/subscriptions/grant', {
          user_id: id,
          tier,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      `Granted ${tier}`,
    )

  if (loading) return <div className="page xwide"><p className="text-sm">Loading...</p></div>
  if (error) {
    return (
      <div className="page xwide">
        <div className="alert alert-error">{error}</div>
        <Link to="/admin">← Back to admin</Link>
      </div>
    )
  }
  if (!detail) return null

  return (
    <div className="page xwide">
      <div className="row" style={{ marginBottom: '1rem' }}>
        <Link to="/admin">← Back to admin</Link>
      </div>
      <h1 style={{ marginBottom: '1rem' }}>@{detail.username}</h1>

      {msg && <div className="alert alert-success">{msg}</div>}
      {actionError && <div className="alert alert-error">{actionError}</div>}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <dl className="info-grid">
          <dt>User ID</dt>
          <dd style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{detail.id}</dd>
          <dt>Email</dt><dd>{detail.email}</dd>
          <dt>Role</dt><dd><RoleBadge role={detail.role} /></dd>
          <dt>Verified</dt><dd><YesNo value={detail.is_verified} /></dd>
          <dt>Active</dt><dd><YesNo value={detail.is_active} /></dd>
          <dt>Joined</dt><dd>{fmtDate(detail.created_at)}</dd>
          <dt>Subscription</dt>
          <dd>
            <TierBadge tier={detail.subscription?.effective_tier} />
            {detail.subscription?.expires_at && (
              <span className="text-sm"> · expires {fmtDate(detail.subscription.expires_at)}</span>
            )}
          </dd>
        </dl>
      </div>

      {canModerate && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2>Actions</h2>
          <div className="row" style={{ marginBottom: '1rem' }}>
            <button
              className={`btn ${detail.is_active ? 'btn-danger' : 'btn-primary'}`}
              disabled={busy}
              onClick={toggleActive}
            >
              {detail.is_active ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>

          {canAdmin && (
            <div className="row" style={{ gap: '0.5rem', marginBottom: '1rem' }}>
              <select value={role} onChange={e => setRole(e.target.value)} style={selectStyle}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button className="btn btn-ghost" disabled={busy} onClick={changeRole}>Change role</button>
            </div>
          )}

          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <select value={tier} onChange={e => setTier(e.target.value)} style={selectStyle}>
              {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
              style={selectStyle}
            />
            <button className="btn btn-ghost" disabled={busy} onClick={grantSub}>Grant subscription</button>
          </div>
          <span className="text-sm">Leave date empty for no expiry.</span>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2>Active sessions ({detail.sessions.length})</h2>
        {detail.sessions.length === 0 && <p className="text-sm">No active sessions.</p>}
        {detail.sessions.map(s => (
          <div key={s.id} className="session-card">
            <div className="session-info">
              <strong>{s.device_info ?? 'Unknown device'}</strong>
              <span>IP: {s.ip_address ?? '—'}</span><br />
              <span>Last used: {fmtDate(s.last_used_at)}</span><br />
              <span>Expires: {fmtDate(s.expires_at)}</span>
            </div>
          </div>
        ))}
      </div>

      {canAdmin && (
        <div className="card">
          <h2>Audit history</h2>
          {detail.audit.length === 0 && <p className="text-sm">No audit entries for this user.</p>}
          {detail.audit.length > 0 && (
            <table className="admin-table">
              <thead>
                <tr><th>When</th><th>Actor</th><th>Action</th><th>Details</th></tr>
              </thead>
              <tbody>
                {detail.audit.map(a => (
                  <tr key={a.id}>
                    <td>{fmtDate(a.created_at)}</td>
                    <td>{a.actor_username ?? a.actor_id}</td>
                    <td>{a.action}</td>
                    <td className="text-sm">{formatDetails(a.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
