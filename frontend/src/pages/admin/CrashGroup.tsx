import { Fragment, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { ArrowLeft, Bug, ChevronDown } from 'lucide-react'
import { crashApi } from '../../api/endpoints'
import { CRASH_STATUSES, type CrashGroup, type CrashGroupDetail, type CrashStatus } from '../../api/types'
import { Head } from '../../head/Head'
import { LocalLink, fmt, useLocale } from '../../i18n'
import { formatDateTime, formatNumber, formatRelative } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { Button, DelayedReveal, EmptyState, Field, IconButton, Input, LoadError, PageHead, Pill, Section, Select, Skeleton, Stat, Table, Textarea } from '../../ui'
import { CrashStack, CrashStatusPill } from '../../features/admin/crash'
import { useAdminAction, useAdminDict, type AdminDict } from '../../features/admin/useAdmin'
import '../../features/admin/admin.css'

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export default function AdminCrashGroup() {
  const { id = '' } = useParams()
  const p = useAdminDict()
  const locale = useLocale()
  const res = useAsync(() => crashApi.group(id), [id])
  const g = res.data
  const latestId = g?.reports[0]?.id
  const latest = useAsync(() => (latestId ? crashApi.report(latestId) : Promise.resolve(null)), [latestId])

  if (res.error && !g)
    return (
      <>
        <Head title={p.crashes.title} noindex />
        <BackLink p={p} />
        {res.error.status === 404 ? (
          <EmptyState className="card" icon={<Bug size={18} />} title={p.crash.notFound} text={p.crash.notFoundText} action={<LocalLink to="/admin/crashes" className="link">{p.crash.back}</LocalLink>} />
        ) : (
          <LoadError text={res.error.message} onRetry={res.reload} />
        )}
      </>
    )
  if (!g)
    return (
      <>
        <Head title={p.crashes.title} noindex />
        <BackLink p={p} />
        <DelayedReveal className="adm-detail-skel">
          <Skeleton width="20rem" height="1.75rem" />
          <Skeleton height="7rem" radius="var(--r-2xl)" />
          <Skeleton height="14rem" radius="var(--r-2xl)" />
        </DelayedReveal>
      </>
    )

  return (
    <>
      <Head title={g.title} noindex />
      <BackLink p={p} />
      <PageHead
        title={g.title}
        className="adm-user-head adm-crash-head"
        lead={
          <span className="adm-user-pills">
            <CrashStatusPill status={g.status} />
            <Pill>{p.crashes.kinds[g.kind]}</Pill>
            <code className="adm-mono">{g.error_code}</code>
          </span>
        }
      />

      <div className="adm-tiles adm-crash-tiles">
        <Stat label={p.crash.reports} value={formatNumber(g.report_count, locale)} />
        <Stat label={p.crash.firstSeen} value={formatRelative(g.first_seen, locale)} hint={formatDateTime(g.first_seen, locale)} />
        <Stat label={p.crash.lastSeen} value={formatRelative(g.last_seen, locale)} hint={formatDateTime(g.last_seen, locale)} />
        <Stat label={p.crash.lastVersion} value={g.last_app_version} />
      </div>

      <div className="adm-detail-grid">
        <Triage key={`${g.status}|${g.resolved_in_version}|${g.notes}`} g={g} onSaved={(next) => res.mutate((x) => ({ ...x, ...next }))} />
        <Section title={p.crash.stack} lead={latest.data ? fmt(p.crash.stackOf, { version: latest.data.app_version }) : undefined} className="adm-section">
          {latest.error ? (
            <LoadError text={latest.error.message} onRetry={latest.reload} className="" />
          ) : latest.data ? (
            <>
              {latest.data.payload.message && (
                <pre className="adm-pre adm-crash-message">{latest.data.payload.message}</pre>
              )}
              <CrashStack report={latest.data} />
            </>
          ) : latest.data === null ? null : (
            <Skeleton height="8rem" />
          )}
        </Section>
        <Reports g={g} p={p} />
      </div>
    </>
  )
}

function BackLink({ p }: { p: AdminDict }) {
  return (
    <LocalLink to="/admin/crashes" className="adm-back">
      <ArrowLeft size={14} aria-hidden />
      {p.crash.back}
    </LocalLink>
  )
}

function Triage({ g, onSaved }: { g: CrashGroupDetail; onSaved: (g: CrashGroup) => void }) {
  const p = useAdminDict()
  const c = p.crash
  const { run, busy } = useAdminAction()
  const [status, setStatus] = useState<CrashStatus>(g.status)
  const [version, setVersion] = useState(g.resolved_in_version ?? '')
  const [notes, setNotes] = useState(g.notes ?? '')
  const [versionError, setVersionError] = useState<string>()

  const versionOk = (v: string) => !v.trim() || SEMVER.test(v.trim())
  const dirty = status !== g.status || version.trim() !== (g.resolved_in_version ?? '') || notes !== (g.notes ?? '')

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!versionOk(version)) return setVersionError(c.errVersion)
    const body = {
      ...(status !== g.status && { status }),
      ...(version.trim() !== (g.resolved_in_version ?? '') && { resolved_in_version: version.trim() || null }),
      ...(notes !== (g.notes ?? '') && { notes: notes.trim() ? notes : null }),
    }
    const r = await run('triage', () => crashApi.update(g.id, body), c.saved)
    if (r) onSaved(r)
  }

  return (
    <Section title={c.triage} className="adm-section">
      <form className="adm-triage" onSubmit={save} noValidate>
        <Field label={c.status}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as CrashStatus)}>
            {CRASH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {p.crashes.statuses[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={c.resolvedIn} hint={c.resolvedInHint} error={versionError}>
          <Input
            value={version}
            placeholder="0.8.1"
            spellCheck={false}
            maxLength={64}
            onChange={(e) => (setVersion(e.target.value), versionError && versionOk(e.target.value) && setVersionError(undefined))}
            onBlur={() => setVersionError(versionOk(version) ? undefined : c.errVersion)}
          />
        </Field>
        <Field label={c.notes}>
          <Textarea value={notes} rows={4} maxLength={10_000} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" disabled={!dirty} loading={busy === 'triage'}>
          {c.save}
        </Button>
      </form>
    </Section>
  )
}

function Reports({ g, p }: { g: CrashGroupDetail; p: AdminDict }) {
  const c = p.crash
  const locale = useLocale()
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Section
      title={
        <>
          {c.recent} <span className="t-muted num">{g.reports.length}</span>
        </>
      }
      className="adm-section adm-span-2"
    >
      <Table label={c.recentLabel} className="adm-audit adm-crash-reports">
        <thead>
          <tr>
            <th scope="col">{c.colReceived}</th>
            <th scope="col">{p.crashes.version}</th>
            <th scope="col">{c.colUser}</th>
            <th scope="col">{c.install}</th>
            <th scope="col">
              <span className="sr-only">{c.expand}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {g.reports.map((r) => {
            const isOpen = open === r.id
            const detailId = `crash-report-${r.id}`
            return (
              <Fragment key={r.id}>
                <tr>
                  <td className="adm-tab adm-nowrap">{formatDateTime(r.received_at, locale)}</td>
                  <td className="adm-tab">{r.app_version}</td>
                  <td>{r.user_id ? <LocalLink to={`/admin/users/${r.user_id}`}>{r.user_email ?? r.user_id.slice(0, 8)}</LocalLink> : <span className="t-muted">{c.anonymous}</span>}</td>
                  <td>
                    <code className="adm-mono t-muted">{r.install_id.slice(0, 8)}</code>
                  </td>
                  <td className="adm-cell-action">
                    <IconButton
                      small
                      label={isOpen ? c.collapse : c.expand}
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? detailId : undefined}
                      className="adm-expand"
                      data-open={isOpen || undefined}
                      icon={<ChevronDown size={14} />}
                      onClick={() => setOpen(isOpen ? null : r.id)}
                    />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="adm-detail-row" id={detailId}>
                    <td colSpan={5}>
                      <ReportDetail id={r.id} p={p} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </Table>
    </Section>
  )
}

function ReportDetail({ id, p }: { id: string; p: AdminDict }) {
  const c = p.crash
  const locale = useLocale()
  const res = useAsync(() => crashApi.report(id), [id])
  if (res.error) return <LoadError text={res.error.message} onRetry={res.reload} className="" />
  const r = res.data
  if (!r) return <Skeleton height="6rem" />
  const pl = r.payload
  const facts: [string, string][] = [
    [c.colUser, r.user_email ?? c.anonymous],
    [c.os, pl.os_version],
    [c.webview, pl.webview_version ?? '·'],
    [c.install, pl.install_id],
  ]
  return (
    <div className="adm-crash-report">
      <dl className="adm-facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="adm-mono">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="adm-h3">{c.comment}</h3>
        {pl.user_comment ? <p className="adm-comment">{pl.user_comment}</p> : <p className="t-muted t-s">{c.noComment}</p>}
      </div>
      <div>
        <h3 className="adm-h3">{c.breadcrumbs}</h3>
        {pl.breadcrumbs.length ? (
          <ol className="adm-crumbs adm-mono">
            {pl.breadcrumbs.map((b, i) => (
              <li key={i}>
                <span className="t-muted">{formatDateTime(b.ts, locale)}</span> <span className="adm-crumb-cat">{b.category}</span> {b.message}
              </li>
            ))}
          </ol>
        ) : (
          <p className="t-muted t-s">{c.noBreadcrumbs}</p>
        )}
      </div>
      <div>
        <h3 className="adm-h3">{c.logTail}</h3>
        <pre className="adm-pre adm-log" tabIndex={0}>{pl.log_tail}</pre>
      </div>
    </div>
  )
}
