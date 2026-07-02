import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import UsersList from './admin/UsersList'
import StatsPanel from './admin/StatsPanel'
import AuditLog from './admin/AuditLog'

const ROLE_LEVEL: Record<string, number> = {
  user: 0,
  support: 1,
  moderator: 2,
  admin: 3,
}

type TabId = 'users' | 'stats' | 'audit'

export default function Admin() {
  const { user } = useAuth()
  const level = ROLE_LEVEL[user?.role ?? 'user'] ?? 0
  const isAdmin = level >= ROLE_LEVEL.admin
  const [tab, setTab] = useState<TabId>('users')

  return (
    <div className="page xwide">
      <h1>Admin</h1>
      <div className="row" style={{ marginBottom: '1.5rem', gap: '0.5rem' }}>
        <button
          className={`btn ${tab === 'users' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('users')}
        >
          Users
        </button>
        <button
          className={`btn ${tab === 'stats' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('stats')}
        >
          Stats
        </button>
        {isAdmin && (
          <button
            className={`btn ${tab === 'audit' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('audit')}
          >
            Audit Log
          </button>
        )}
      </div>

      {tab === 'users' && <UsersList />}
      {tab === 'stats' && <StatsPanel />}
      {tab === 'audit' && isAdmin && <AuditLog />}
    </div>
  )
}
