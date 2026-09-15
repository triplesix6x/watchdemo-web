import { Fragment, useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { AdminRelease, Paginated } from '../../types'
import PublishRelease from './PublishRelease'
import { fmtDate, Pagination, YesNo } from './shared'

const PAGE_SIZE = 25

function fmtSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Релизы десктопного клиента: заливка новой сборки и список раскатанных.
 *
 * Release notes видны только здесь: клиенту на экране обновления
 * человекочитаемый changelog не показывается — это заметки для нас.
 *
 * Публиковать может только админ — в обход этой формы то же самое делает
 * scripts/publish-release.ps1 из репозитория приложения. Гашение релиза
 * мгновенно убирает сборку из выдачи апдейтера, и клиенты, не успевшие
 * обновиться, остаются на предыдущей версии.
 */
export default function ReleasesPanel({ canAdmin }: { canAdmin: boolean }) {
  const [page, setPage] = useState(1)
  const [channel, setChannel] = useState<'' | 'stable' | 'beta'>('')
  const [data, setData] = useState<Paginated<AdminRelease> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(PAGE_SIZE),
      })
      if (channel) params.set('channel', channel)
      setData(await api.get<Paginated<AdminRelease>>(`/admin/releases?${params}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load releases')
    } finally {
      setLoading(false)
    }
  }, [page, channel])

  useEffect(() => { load() }, [load])

  const toggleActive = async (release: AdminRelease) => {
    if (release.is_active && !confirm(
      `Disable ${release.version}? Clients that have not updated yet will stay on the previous version.`,
    )) return
    setBusyId(release.id)
    setError('')
    try {
      await api.patch(`/admin/releases/${release.id}/active`, { is_active: !release.is_active })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      {canAdmin && <PublishRelease onPublished={() => { setPage(1); load() }} />}

      <div className="row" style={{ gap: '0.5rem', marginBottom: '1rem' }}>
        {(['', 'stable', 'beta'] as const).map(c => (
          <button
            key={c || 'all'}
            className={`btn ${channel === c ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setChannel(c); setPage(1) }}
          >
            {c || 'all'}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="text-sm">Loading...</p>}

      {data && !loading && (
        <>
          {data.items.length === 0 && <p className="text-sm">No releases published yet.</p>}
          {data.items.length > 0 && (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Channel</th>
                  <th>Platform</th>
                  <th>Size</th>
                  <th>Published</th>
                  <th>Live</th>
                  {canAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map(r => (
                  <Fragment key={r.id}>
                    <tr className={r.notes ? 'with-notes' : undefined}>
                      <td>
                        <a href={r.url} title={`sha256: ${r.sha256}`}>{r.version}</a>
                      </td>
                      <td><span className="badge badge-basic">{r.channel}</span></td>
                      <td className="text-sm">{r.target}/{r.arch}</td>
                      <td className="text-sm">{fmtSize(r.file_size)}</td>
                      <td className="text-sm">{fmtDate(r.published_at)}</td>
                      <td><YesNo value={r.is_active} /></td>
                      {canAdmin && (
                        <td>
                          <button
                            className={`btn ${r.is_active ? 'btn-danger' : 'btn-primary'}`}
                            style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
                            disabled={busyId === r.id}
                            onClick={() => toggleActive(r)}
                          >
                            {r.is_active ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      )}
                    </tr>
                    {r.notes && (
                      <tr className="notes-row">
                        <td colSpan={canAdmin ? 7 : 6}>
                          <span className="notes-label">Notes</span>
                          {r.notes}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
          <Pagination
            page={data.page}
            total={data.total}
            pageSize={data.page_size}
            onChange={setPage}
          />
        </>
      )}
    </div>
  )
}
