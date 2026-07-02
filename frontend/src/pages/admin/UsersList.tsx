import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { AdminUserListItem, Paginated } from '../../types'
import { fmtDate, Pagination, RoleBadge, TierBadge, YesNo } from './shared'

const PAGE_SIZE = 25

export default function UsersList() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [qInput, setQInput] = useState('')
  const [role, setRole] = useState('')
  const [verified, setVerified] = useState('')
  const [active, setActive] = useState('')
  const [tier, setTier] = useState('')
  const [data, setData] = useState<Paginated<AdminUserListItem> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
    if (q) params.set('q', q)
    if (role) params.set('role', role)
    if (verified) params.set('verified', verified)
    if (active) params.set('active', active)
    if (tier) params.set('tier', tier)
    try {
      setData(await api.get<Paginated<AdminUserListItem>>(`/admin/users?${params.toString()}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [page, q, role, verified, active, tier])

  useEffect(() => { load() }, [load])

  // Смена фильтра всегда сбрасывает на первую страницу.
  const onFilter = (setter: (v: string) => void) => (e: { target: { value: string } }) => {
    setPage(1)
    setter(e.target.value)
  }

  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    setPage(1)
    setQ(qInput.trim())
  }

  return (
    <>
      <form className="filters" onSubmit={onSearch}>
        <input
          type="text"
          placeholder="Search username / email"
          value={qInput}
          onChange={e => setQInput(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <button type="submit" className="btn btn-ghost" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
          Search
        </button>
        <select value={role} onChange={onFilter(setRole)}>
          <option value="">All roles</option>
          <option value="user">user</option>
          <option value="support">support</option>
          <option value="moderator">moderator</option>
          <option value="admin">admin</option>
        </select>
        <select value={verified} onChange={onFilter(setVerified)}>
          <option value="">Any verification</option>
          <option value="true">Verified</option>
          <option value="false">Unverified</option>
        </select>
        <select value={active} onChange={onFilter(setActive)}>
          <option value="">Any status</option>
          <option value="true">Active</option>
          <option value="false">Deactivated</option>
        </select>
        <select value={tier} onChange={onFilter(setTier)}>
          <option value="">Any tier</option>
          <option value="none">No subscription</option>
          <option value="basic">Basic</option>
          <option value="plus">Plus</option>
          <option value="pro">Pro</option>
        </select>
      </form>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="text-sm">Loading...</p>}

      {!loading && data && (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Role</th>
                <th>Verified</th>
                <th>Active</th>
                <th>Joined</th>
                <th>Subscription</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(u => (
                <tr key={u.id} className="clickable" onClick={() => navigate(`/admin/users/${u.id}`)}>
                  <td>{u.username}</td>
                  <td>{u.email}</td>
                  <td><RoleBadge role={u.role} /></td>
                  <td><YesNo value={u.is_verified} /></td>
                  <td><YesNo value={u.is_active} /></td>
                  <td>{fmtDate(u.created_at)}</td>
                  <td><TierBadge tier={u.subscription?.effective_tier} /></td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr><td colSpan={7} className="text-sm">No users match these filters.</td></tr>
              )}
            </tbody>
          </table>
          <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}
    </>
  )
}
