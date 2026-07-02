import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { AuditItem, Paginated } from '../../types'
import { fmtDate, formatDetails, Pagination } from './shared'

const PAGE_SIZE = 25

export default function AuditLog() {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Paginated<AuditItem> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await api.get<Paginated<AuditItem>>(`/admin/audit?page=${page}&page_size=${PAGE_SIZE}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => { load() }, [load])

  if (loading) return <p className="text-sm">Loading...</p>
  if (error) return <div className="alert alert-error">{error}</div>
  if (!data) return null

  return (
    <>
      <table className="admin-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Details</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map(a => (
            <tr key={a.id}>
              <td>{fmtDate(a.created_at)}</td>
              <td>{a.actor_username ?? a.actor_id}</td>
              <td>{a.action}</td>
              <td>{a.target_username ?? a.target_user_id ?? '—'}</td>
              <td className="text-sm">{formatDetails(a.details)}</td>
              <td>{a.ip_address ?? '—'}</td>
            </tr>
          ))}
          {data.items.length === 0 && (
            <tr><td colSpan={6} className="text-sm">No audit entries yet.</td></tr>
          )}
        </tbody>
      </table>
      <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
    </>
  )
}
