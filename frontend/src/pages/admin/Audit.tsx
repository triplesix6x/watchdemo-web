import { useSearchParams } from 'react-router-dom'
import { ScrollText } from 'lucide-react'
import { adminApi } from '../../api/endpoints'
import { useAsync } from '../../lib/useAsync'
import { ButtonLink, DelayedReveal, EmptyState, LoadError, PageHead, Pagination, Skeleton } from '../../ui'
import { AuditTable } from '../../features/admin/parts'
import { useAdminDict } from '../../features/admin/useAdmin'
import '../../features/admin/admin.css'

const PAGE_SIZE = 25

export default function AdminAudit() {
  const p = useAdminDict()
  const [sp, setSp] = useSearchParams()
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const list = useAsync(() => adminApi.audit(page, PAGE_SIZE), [page])
  const data = list.data

  return (
    <>
      <PageHead title={p.audit.title} lead={p.audit.lead} />
      {list.error && !data ? (
        <LoadError text={list.error.message} onRetry={list.reload} />
      ) : !data ? (
        <DelayedReveal className="card adm-skeleton-rows">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} height="1.25rem" />
          ))}
        </DelayedReveal>
      ) : data.items.length === 0 ? (
        <EmptyState className="card" icon={<ScrollText size={18} />} title={p.audit.emptyTitle} text={p.audit.emptyText} action={<ButtonLink to="/admin/users">{p.audit.toUsers}</ButtonLink>} />
      ) : (
        <div data-stale={list.loading || undefined}>
          <AuditTable items={data.items} />
          <Pagination className="adm-pagination" page={data.page} pageSize={data.page_size} total={data.total} onPage={(n) => setSp(new URLSearchParams({ page: String(n) }))} />
        </div>
      )}
    </>
  )
}
