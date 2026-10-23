import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Package, PencilLine, Upload } from 'lucide-react'
import { adminApi } from '../../api/endpoints'
import type { AdminRelease, Channel } from '../../api/types'
import { useAuth } from '../../context/AuthContext'
import { fmt, useLocale, useT } from '../../i18n'
import { formatBytes, formatDate } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { Button, ConfirmModal, CopyButton, DelayedReveal, Dialog, EmptyState, Field, IconButton, LoadError, Markdown, PageHead, Pagination, Pill, Seg, Skeleton, Switch, Table, Textarea } from '../../ui'
import { can } from '../../features/admin/access'
import { PublishDialog } from '../../features/admin/PublishDialog'
import { useAdminAction, useAdminDict } from '../../features/admin/useAdmin'
import '../../features/admin/admin.css'

type Filter = 'all' | Channel

export default function AdminReleases() {
  const p = useAdminDict()
  const locale = useLocale()
  const { user } = useAuth()
  const admin = can(user?.role, 'manageReleases')
  const [sp, setSp] = useSearchParams()
  const channel: Filter = sp.get('channel') === 'stable' || sp.get('channel') === 'beta' ? (sp.get('channel') as Channel) : 'all'
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const list = useAsync(() => adminApi.releases({ page, page_size: 25, channel: channel === 'all' ? undefined : channel }), [channel, page])
  const [publishing, setPublishing] = useState(false)
  const [kill, setKill] = useState<AdminRelease | null>(null)
  const [editing, setEditing] = useState<AdminRelease | null>(null)
  const { run, busy } = useAdminAction()

  const rows = list.data?.items ?? []
  const put = (r: AdminRelease) => list.mutate((d) => ({ ...d, items: d.items.map((x) => (x.id === r.id ? r : x)) }))

  const setChannel = (c: Filter) => {
    const next = new URLSearchParams()
    if (c !== 'all') next.set('channel', c)
    setSp(next, { replace: true })
  }

  const setActive = async (r: AdminRelease, on: boolean) => {
    put({ ...r, is_active: on })
    const res = await run(`active-${r.id}`, () => adminApi.setReleaseActive(r.id, on), fmt(on ? p.releases.restored : p.releases.killed, { version: r.version }))
    put(res ?? r)
    setKill(null)
  }
  const setShown = async (r: AdminRelease, on: boolean) => {
    put({ ...r, show_in_changelog: on })
    const res = await run(`show-${r.id}`, () => adminApi.updateRelease(r.id, { show_in_changelog: on }), fmt(on ? p.releases.shown : p.releases.hidden, { version: r.version }))
    put(res ?? r)
  }

  const data = list.data

  return (
    <>
      <PageHead
        title={p.releases.title}
        lead={p.releases.lead}
        aside={
          admin && (
            <Button variant="primary" onClick={() => setPublishing(true)}>
              <Upload size={15} aria-hidden />
              {p.releases.publish}
            </Button>
          )
        }
      />

      <div className="adm-toolbar">
        <Seg
          label={p.releases.channel}
          value={channel}
          onChange={setChannel}
          items={[
            { value: 'all', label: p.releases.all },
            { value: 'stable', label: p.releases.stable },
            { value: 'beta', label: p.releases.beta },
          ]}
        />
      </div>

      {list.error && !data ? (
        <LoadError text={list.error.message} onRetry={list.reload} />
      ) : !data ? (
        <DelayedReveal className="card adm-skeleton-rows">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} height="1.25rem" />
          ))}
        </DelayedReveal>
      ) : rows.length === 0 ? (
        <EmptyState
          className="card"
          icon={<Package size={18} />}
          title={channel === 'all' ? p.releases.emptyTitle : p.releases.emptyFiltered}
          text={channel === 'all' ? p.releases.emptyText : undefined}
          action={
            channel !== 'all' ? (
              <Button variant="soft" onClick={() => setChannel('all')}>
                {p.releases.showAll}
              </Button>
            ) : (
              admin && (
                <Button variant="soft" onClick={() => setPublishing(true)}>
                  {p.releases.publish}
                </Button>
              )
            )
          }
        />
      ) : (
        <div data-stale={list.loading || undefined} className="adm-releases">
          <Table label={p.releases.tableLabel}>
            <thead>
              <tr>
                <th scope="col">{p.releases.version}</th>
                <th scope="col">{p.releases.channel}</th>
                <th scope="col">{p.releases.platform}</th>
                <th scope="col" className="num">
                  {p.releases.size}
                </th>
                <th scope="col">{p.releases.sha}</th>
                <th scope="col" className="num">
                  {p.releases.published}
                </th>
                <th scope="col">{p.releases.active}</th>
                <th scope="col">{p.releases.changelogShort}</th>
                <th scope="col">{p.releases.notes}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-inactive={!r.is_active || undefined}>
                  <td>
                    <a href={r.url} className="num adm-version adm-nowrap" download>
                      {r.version}
                    </a>
                  </td>
                  <td>
                    <Pill tone={r.channel === 'beta' ? 'warning' : 'neutral'}>{r.channel === 'beta' ? p.releases.beta : p.releases.stable}</Pill>
                  </td>
                  <td className="t-muted adm-nowrap">
                    {r.target}/{r.arch}
                  </td>
                  <td className="num adm-nowrap">{formatBytes(r.file_size, locale)}</td>
                  <td>
                    <span className="adm-sha">
                      <code title={r.sha256}>{r.sha256.slice(0, 8)}</code>
                      <CopyButton icon text={r.sha256} label={`${p.releases.copySha} ${r.version}`} />
                    </span>
                  </td>
                  <td className="num adm-nowrap">{formatDate(r.published_at, locale)}</td>
                  <td>
                    {admin ? (
                      <Switch
                        label={<span className="sr-only">{`${p.releases.active} ${r.version}`}</span>}
                        checked={r.is_active}
                        disabled={busy === `active-${r.id}`}
                        onChange={(on) => (on ? setActive(r, true) : setKill(r))}
                      />
                    ) : (
                      <span className="t-muted">{r.is_active ? p.releases.yes : p.releases.no}</span>
                    )}
                  </td>
                  <td>
                    {admin ? (
                      <Switch
                        label={<span className="sr-only">{`${p.releases.changelog} ${r.version}`}</span>}
                        checked={r.show_in_changelog}
                        disabled={busy === `show-${r.id}`}
                        onChange={(on) => setShown(r, on)}
                      />
                    ) : (
                      <span className="t-muted">{r.show_in_changelog ? p.releases.yes : p.releases.no}</span>
                    )}
                  </td>
                  <td className="adm-notes-cell">
                    <span className="adm-notes-snippet">{r.notes?.split('\n')[0]?.replace(/^[-*] /, '') ?? '·'}</span>
                    {admin && <IconButton small label={fmt(p.releases.editNotes, { version: r.version })} icon={<PencilLine size={14} />} onClick={() => setEditing(r)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            className="adm-pagination"
            page={data.page}
            pageSize={data.page_size}
            total={data.total}
            onPage={(n) => {
              const next = new URLSearchParams(sp)
              next.set('page', String(n))
              setSp(next)
            }}
          />
        </div>
      )}

      {kill && (
        <ConfirmModal
          open
          variant="danger"
          title={p.releases.killTitle}
          message={fmt(p.releases.killText, { version: kill.version })}
          confirmLabel={fmt(p.releases.killConfirm, { version: kill.version })}
          busy={busy === `active-${kill.id}`}
          onConfirm={() => setActive(kill, false)}
          onCancel={() => setKill(null)}
        />
      )}
      {editing && (
        <NotesDialog
          release={editing}
          busy={busy === `notes-${editing.id}`}
          onClose={() => setEditing(null)}
          onSave={async (notes) => {
            const res = await run(`notes-${editing.id}`, () => adminApi.updateRelease(editing.id, { notes: notes || null }), fmt(p.releases.notesSaved, { version: editing.version }))
            if (res) {
              put(res)
              setEditing(null)
            }
          }}
        />
      )}
      {publishing && (
        <PublishDialog
          onClose={() => setPublishing(false)}
          onPublished={() => {
            setPublishing(false)
            if (page !== 1) setSp(new URLSearchParams(channel === 'all' ? {} : { channel }))
            else list.reload()
          }}
        />
      )}
    </>
  )
}

function NotesDialog({ release, busy, onClose, onSave }: { release: AdminRelease; busy: boolean; onClose: () => void; onSave: (notes: string) => void }) {
  const p = useAdminDict()
  const t = useT()
  const [text, setText] = useState(release.notes ?? '')
  const changed = text.trim() !== (release.notes ?? '').trim()
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      busy={busy}
      title={fmt(p.releases.notesTitle, { version: release.version })}
      footer={
        <>
          <Button variant="soft" onClick={onClose} disabled={busy}>
            {t.actions.cancel}
          </Button>
          <Button variant="primary" loading={busy} disabled={!changed} onClick={() => onSave(text.trim())}>
            {p.releases.saveNotes}
          </Button>
        </>
      }
    >
      <div className="adm-notes-edit">
        <Field label={p.releases.notesField} hint={p.releases.notesHint}>
          <Textarea data-autofocus rows={10} value={text} onChange={(e) => setText(e.target.value)} maxLength={20000} />
        </Field>
        <section className="adm-notes-preview" aria-label={p.releases.preview}>
          <p className="field-label" aria-hidden="true">
            {p.releases.preview}
          </p>
          <div className="card">{text.trim() ? <Markdown text={text} className="adm-notes" /> : <p className="t-muted t-s">{p.releases.previewEmpty}</p>}</div>
        </section>
      </div>
    </Dialog>
  )
}
