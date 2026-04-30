import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'

type TabId = 'subscription' | 'role'

const ROLE_LEVEL: Record<string, number> = {
  user: 0,
  support: 1,
  moderator: 2,
  admin: 3,
}

export default function Admin() {
  const { user } = useAuth()
  const level = ROLE_LEVEL[user?.role ?? 'user'] ?? 0

  const canGrantSubscription = level >= ROLE_LEVEL.moderator
  const canGrantRole = level >= ROLE_LEVEL.admin

  const defaultTab: TabId = canGrantSubscription ? 'subscription' : 'role'
  const [tab, setTab] = useState<TabId>(defaultTab)

  if (!canGrantSubscription && !canGrantRole) {
    return (
      <div className="page">
        <h1>Admin</h1>
        <div className="card">
          <div className="alert alert-info">
            Your role (<strong>{user?.role}</strong>) has no administrative actions available yet.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <h1>Admin</h1>
      <div className="row" style={{ marginBottom: '1.5rem', gap: '0.5rem' }}>
        {canGrantSubscription && (
          <button
            className={`btn ${tab === 'subscription' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('subscription')}
          >
            Grant Subscription
          </button>
        )}
        {canGrantRole && (
          <button
            className={`btn ${tab === 'role' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('role')}
          >
            Assign Role
          </button>
        )}
      </div>
      {tab === 'subscription' && canGrantSubscription && <GrantSubscription />}
      {tab === 'role' && canGrantRole && <GrantRole />}
    </div>
  )
}

function GrantSubscription() {
  const [identifier, setIdentifier] = useState('')
  const [byUsername, setByUsername] = useState(true)
  const [tier, setTier] = useState<'basic' | 'plus' | 'pro'>('plus')
  const [expiresAt, setExpiresAt] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const body = {
        ...(byUsername ? { username: identifier.trim() } : { user_id: identifier.trim() }),
        tier,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      }
      const data = await api.post<{
        user_id: string
        tier: string
        expires_at: string | null
      }>('/admin/subscriptions/grant', body)
      setResult(
        `Granted "${data.tier}" to user ${data.user_id}. ` +
        `Expires: ${data.expires_at ? new Date(data.expires_at).toLocaleString() : 'never'}`
      )
      setIdentifier('')
      setExpiresAt('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grant subscription')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      {error && <div className="alert alert-error">{error}</div>}
      {result && <div className="alert alert-success">{result}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Identify by</label>
          <div className="row" style={{ marginTop: '0.25rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
              <input type="radio" checked={byUsername} onChange={() => setByUsername(true)} />
              Username
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
              <input type="radio" checked={!byUsername} onChange={() => setByUsername(false)} />
              User ID
            </label>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="sub_identifier">{byUsername ? 'Username' : 'User ID (UUID)'}</label>
          <input
            id="sub_identifier"
            type="text"
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            placeholder={byUsername ? 'john_doe' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="tier">Tier</label>
          <select
            id="tier"
            value={tier}
            onChange={e => setTier(e.target.value as 'basic' | 'plus' | 'pro')}
            style={{ border: '1px solid #d1d5db', borderRadius: 5, padding: '0.55rem 0.75rem', fontSize: '0.95rem' }}
          >
            <option value="basic">Basic</option>
            <option value="plus">Plus</option>
            <option value="pro">Pro</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="expires_at">Expires at</label>
          <input
            id="expires_at"
            type="datetime-local"
            value={expiresAt}
            onChange={e => setExpiresAt(e.target.value)}
          />
          <span className="text-sm">Leave empty for no expiry</span>
        </div>
        <button type="submit" className="btn btn-primary btn-full mt1" disabled={loading}>
          {loading ? 'Granting...' : 'Grant Subscription'}
        </button>
      </form>
    </div>
  )
}

const ROLES = ['user', 'support', 'moderator', 'admin'] as const
type Role = typeof ROLES[number]

function GrantRole() {
  const [identifier, setIdentifier] = useState('')
  const [byUsername, setByUsername] = useState(true)
  const [role, setRole] = useState<Role>('user')
  const [error, setError] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const body = {
        ...(byUsername ? { username: identifier.trim() } : { user_id: identifier.trim() }),
        role,
      }
      const data = await api.post<{ username: string; role: string }>('/admin/users/role', body)
      setResult(`Role "${data.role}" assigned to @${data.username}`)
      setIdentifier('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign role')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      {error && <div className="alert alert-error">{error}</div>}
      {result && <div className="alert alert-success">{result}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Identify by</label>
          <div className="row" style={{ marginTop: '0.25rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
              <input type="radio" checked={byUsername} onChange={() => setByUsername(true)} />
              Username
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
              <input type="radio" checked={!byUsername} onChange={() => setByUsername(false)} />
              User ID
            </label>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="role_identifier">{byUsername ? 'Username' : 'User ID (UUID)'}</label>
          <input
            id="role_identifier"
            type="text"
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            placeholder={byUsername ? 'john_doe' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="role">Role</label>
          <select
            id="role"
            value={role}
            onChange={e => setRole(e.target.value as Role)}
            style={{ border: '1px solid #d1d5db', borderRadius: 5, padding: '0.55rem 0.75rem', fontSize: '0.95rem' }}
          >
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-primary btn-full mt1" disabled={loading}>
          {loading ? 'Assigning...' : 'Assign Role'}
        </button>
      </form>
    </div>
  )
}
