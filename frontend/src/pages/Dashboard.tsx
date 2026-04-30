import { useAuth } from '../context/AuthContext'
import { Link } from 'react-router-dom'

function tierBadge(tier: string) {
  const cls = tier === 'pro' ? 'badge-pro' : tier === 'plus' ? 'badge-plus' : 'badge-basic'
  return <span className={`badge ${cls}`}>{tier}</span>
}

function roleBadge(role: string) {
  const cls = role === 'admin' ? 'badge-admin' : 'badge-basic'
  return <span className={`badge ${cls}`}>{role}</span>
}

export default function Dashboard() {
  const { user } = useAuth()
  if (!user) return null

  const sub = user.subscription

  return (
    <div className="page wide">
      <h1>Dashboard</h1>

      <div className="card">
        <h2>Profile</h2>
        <dl className="info-grid">
          <dt>ID</dt>
          <dd style={{ fontFamily: 'monospace', fontSize: '0.82rem', wordBreak: 'break-all' }}>{user.id}</dd>
          <dt>Username</dt>
          <dd>{user.username}</dd>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Role</dt>
          <dd>{roleBadge(user.role)}</dd>
          <dt>Verified</dt>
          <dd>{user.is_verified ? 'Yes' : 'No — check your email'}</dd>
        </dl>
      </div>

      <div className="card mt2">
        <h2>Subscription</h2>
        {sub ? (
          <dl className="info-grid">
            <dt>Tier</dt>
            <dd>{tierBadge(sub.tier)}</dd>
            <dt>Effective tier</dt>
            <dd>{tierBadge(sub.effective_tier)}</dd>
            <dt>Expires</dt>
            <dd>{sub.expires_at ? new Date(sub.expires_at).toLocaleDateString() : 'Never'}</dd>
            <dt>Status</dt>
            <dd>{sub.is_expired ? 'Expired' : 'Active'}</dd>
          </dl>
        ) : (
          <p className="text-sm">No subscription — on free tier.</p>
        )}
      </div>

      <div className="mt2">
        <Link to="/sessions" className="btn btn-ghost">Manage Sessions</Link>
      </div>
    </div>
  )
}
