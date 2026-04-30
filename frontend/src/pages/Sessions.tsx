import { useState, useEffect, useCallback } from 'react'
import { api, getCurrentSid } from '../api/client'
import type { Session } from '../types'

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleString()
}

export default function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentSid] = useState<string | null>(getCurrentSid)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.get<Session[]>('/users/me/sessions')
      setSessions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const deleteSession = async (id: string) => {
    try {
      await api.delete(`/users/me/sessions/${id}`)
      setSessions(s => s.filter(x => x.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session')
    }
  }

  const deleteAll = async () => {
    if (!confirm('Terminate all other sessions?')) return
    try {
      await api.delete('/users/me/sessions')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete sessions')
    }
  }

  return (
    <div className="page wide">
      <div className="row" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ marginBottom: 0 }}>Active Sessions</h1>
        <span className="spacer" />
        {sessions.length > 1 && (
          <button className="btn btn-danger" onClick={deleteAll}>
            Terminate All Others
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="text-sm">Loading...</p>}

      {!loading && sessions.length === 0 && (
        <p className="text-sm">No active sessions found.</p>
      )}

      {sessions.map(s => {
        const isCurrent = s.id === currentSid
        return (
          <div key={s.id} className={`session-card ${isCurrent ? 'current' : ''}`}>
            <div className="session-info">
              <strong>
                {s.device_info ?? 'Unknown device'}
                {isCurrent && <span style={{ color: '#2563eb', marginLeft: '0.5rem' }}>(current)</span>}
              </strong>
              <span>IP: {s.ip_address ?? '—'}</span><br />
              <span>Last used: {fmt(s.last_used_at)}</span><br />
              <span>Expires: {fmt(s.expires_at)}</span>
            </div>
            {!isCurrent && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem' }}
                onClick={() => deleteSession(s.id)}
              >
                Terminate
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
