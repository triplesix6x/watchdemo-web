import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { AdminStats } from '../../types'

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export default function StatsPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      try {
        setStats(await api.get<AdminStats>('/admin/stats'))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load stats')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) return <p className="text-sm">Loading...</p>
  if (error) return <div className="alert alert-error">{error}</div>
  if (!stats) return null

  return (
    <>
      <div className="stat-grid">
        <Stat label="Total users" value={stats.total} />
        <Stat label="Verified" value={stats.verified} sub={`${stats.unverified} unverified`} />
        <Stat label="Active" value={stats.active} sub={`${stats.deactivated} deactivated`} />
        <Stat label="Paying (plus/pro)" value={stats.paying} />
        <Stat label="New — 7 days" value={stats.signups_7d} />
        <Stat label="New — 30 days" value={stats.signups_30d} />
      </div>

      <h2 className="mt3">By subscription tier</h2>
      <div className="stat-grid">
        <Stat label="No subscription" value={stats.tier_none} />
        <Stat label="Basic" value={stats.tier_basic} />
        <Stat label="Plus" value={stats.tier_plus} />
        <Stat label="Pro" value={stats.tier_pro} />
      </div>
    </>
  )
}
