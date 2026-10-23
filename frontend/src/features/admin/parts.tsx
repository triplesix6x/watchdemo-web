// Small pieces shared by the admin pages.
import { Fragment, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { AuditItem } from '../../api/types'
import { LocalLink, useLocale } from '../../i18n'
import { formatDateTime } from '../../lib/format'
import { IconButton, Table } from '../../ui'
import { useAdminDict } from './useAdmin'

export function useActionName() {
  const p = useAdminDict()
  return (action: string) => p.audit.actions[action] ?? action
}

/** Audit rows with an expandable JSON detail row. `showTarget` off on a user's own card. */
export function AuditTable({ items, showTarget = true }: { items: AuditItem[]; showTarget?: boolean }) {
  const p = useAdminDict()
  const locale = useLocale()
  const actionName = useActionName()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const cols = showTarget ? 6 : 5
  return (
    <Table label={p.audit.tableLabel} className="adm-audit">
      <thead>
        <tr>
          <th scope="col">{p.audit.when}</th>
          <th scope="col">{p.audit.actor}</th>
          <th scope="col">{p.audit.action}</th>
          {showTarget && <th scope="col">{p.audit.target}</th>}
          <th scope="col">{p.audit.ip}</th>
          <th scope="col">
            <span className="sr-only">{p.audit.details}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((a) => {
          const isOpen = open.has(a.id)
          const hasDetails = Object.keys(a.details ?? {}).length > 0
          const detailId = `audit-${a.id}`
          return (
            <Fragment key={a.id}>
              <tr>
                <td className="adm-tab adm-nowrap">{formatDateTime(a.created_at, locale)}</td>
                <td>{a.actor_username ? <LocalLink to={`/admin/users/${a.actor_id}`}>@{a.actor_username}</LocalLink> : <code>{a.actor_id.slice(0, 8)}</code>}</td>
                <td>{actionName(a.action)}</td>
                {showTarget && (
                  <td>
                    {a.target_user_id ? (
                      <LocalLink to={`/admin/users/${a.target_user_id}`}>@{a.target_username ?? a.target_user_id.slice(0, 8)}</LocalLink>
                    ) : typeof a.details?.version === 'string' ? (
                      <span className="adm-tab">{a.details.version}</span>
                    ) : (
                      <span className="t-muted">·</span>
                    )}
                  </td>
                )}
                <td className="adm-tab t-muted">{a.ip_address ?? '·'}</td>
                <td className="adm-cell-action">
                  {hasDetails && (
                    <IconButton
                      small
                      label={isOpen ? p.audit.collapse : p.audit.expand}
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? detailId : undefined}
                      className="adm-expand"
                      data-open={isOpen || undefined}
                      icon={<ChevronDown size={14} />}
                      onClick={() => toggle(a.id)}
                    />
                  )}
                </td>
              </tr>
              {isOpen && (
                <tr className="adm-detail-row" id={detailId}>
                  <td colSpan={cols}>
                    <pre>{JSON.stringify(a.details, null, 2)}</pre>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </Table>
  )
}
