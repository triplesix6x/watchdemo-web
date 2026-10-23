import { useEffect } from 'react'
import { scrollToTarget } from '../engine'
import { AlertTriangle, Download as DownloadIcon, RefreshCw, ScrollText, Send } from 'lucide-react'
import { fmt, useDict, useLocale, useT } from '../i18n'
import ru from '../i18n/pages/changelog.ru'
import en from '../i18n/pages/changelog.en'
import { Head } from '../head/Head'
import { appApi } from '../api/endpoints'
import type { PublicRelease } from '../api/types'
import { useAsync } from '../lib/useAsync'
import { formatDate, formatMonth } from '../lib/format'
import { Button, ButtonLink, EmptyState, Markdown, Pending, Pill, Skeleton } from '../ui'
import { TELEGRAM_CHANNEL } from '../config'
import { versionAnchor } from '../lib/notes'
import '../features/changelog/changelog.css'

/** Stable and beta releases in one list, newest first. Beta notes are public too; a
 *  failed beta request only drops the beta entries. */
async function loadReleases(): Promise<PublicRelease[]> {
  const [stable, beta] = await Promise.all([
    appApi.releases({ channel: 'stable', limit: 50 }),
    appApi.releases({ channel: 'beta', limit: 10 }).catch(() => [] as PublicRelease[]),
  ])
  return [...stable, ...beta].sort((a, b) => b.published_at.localeCompare(a.published_at))
}

/** The release history drawn like the replay's round timeline: one marker per version at
 *  its date (stable a diamond, beta a tick), played up to the latest stable. Each marker
 *  jumps to its entry. The track is in the server HTML, so the markers arriving later
 *  do not move the page. */
function ReleaseTimeline({ list, latestStable, label }: { list?: PublicRelease[]; latestStable?: string; label: string }) {
  const locale = useLocale()
  const times = list?.map((r) => Date.parse(r.published_at)) ?? []
  const min = Math.min(...times)
  const span = Math.max(...times) - min
  const at = (iso: string) => (span > 0 ? 2 + ((Date.parse(iso) - min) / span) * 96 : 98)
  const stable = list?.find((r) => r.version === latestStable)
  const short = (iso: string) => formatMonth(iso, locale)
  const first = list?.[list.length - 1]
  return (
    <nav className="cl-timeline" aria-label={label}>
      <span className="cl-tl-end num">{first ? short(first.published_at) : ''}</span>
      <div className="cl-tl-track">
        {stable && <span className="cl-tl-fill" style={{ width: `${at(stable.published_at)}%` }} />}
        {list?.map((r) => (
          <a
            key={`${r.channel}-${r.version}`}
            href={`#${versionAnchor(r.version)}`}
            className={`cl-tl-mark ${r.channel === 'beta' ? 'is-beta' : 'is-stable'}${r.version === latestStable ? ' is-current' : ''}`}
            style={{ left: `${at(r.published_at)}%` }}
            aria-label={`${r.version}, ${formatDate(r.published_at, locale)}`}
          >
            <span className="cl-tl-tip num" aria-hidden="true">
              {r.version}
            </span>
          </a>
        ))}
      </div>
      <span className="cl-tl-end num">{list?.length ? short(list[0].published_at) : ''}</span>
    </nav>
  )
}

export default function Changelog() {
  const t = useT()
  const p = useDict({ ru, en })
  const locale = useLocale()
  const releases = useAsync(loadReleases, [])
  const list = releases.data
  const latestStable = list?.find((r) => r.channel === 'stable')?.version

  // The entries arrive after the engine tried the #hash, so jump once they are in.
  useEffect(() => {
    if (list?.length && location.hash) scrollToTarget(decodeURIComponent(location.hash), { immediate: true })
  }, [list])

  return (
    <div className="container pp cl">
      <Head title={p.meta.title} description={p.meta.description} />
      <header className="pp-head cl-head">
        <h1>{p.h1}</h1>
        <p className="t-lead">{p.lead}</p>
        <ButtonLink href={TELEGRAM_CHANNEL} variant="soft" className="cl-channel">
          <Send size={15} aria-hidden className="nudge-out" />
          {p.channel}
        </ButtonLink>
      </header>
      <ReleaseTimeline list={list} latestStable={latestStable} label={p.timeline} />

      <div className="cl-body">
        {list?.length ? (
          <ol className="cl-list" role="list">
            {list.map((r) => {
              const id = versionAnchor(r.version)
              const latest = r.version === latestStable
              return (
                <li key={`${r.channel}-${r.version}`}>
                  <article id={id} className={`cl-entry${latest ? ' is-latest card' : ''}`} aria-labelledby={`${id}-title`}>
                    <div className="cl-meta">
                      <h2 id={`${id}-title`} className="cl-version num">
                        <a href={`#${id}`}>
                          {r.version}
                        </a>
                      </h2>
                      <time className="cl-date" dateTime={r.published_at}>
                        {formatDate(r.published_at, locale)}
                      </time>
                      <span className="cl-pills">
                        {latest && <Pill tone="success">{p.latest}</Pill>}
                        {r.channel === 'beta' && <Pill tone="warning">{p.beta}</Pill>}
                      </span>
                    </div>
                    <div className="cl-notes">
                      {r.notes?.trim() ? <Markdown text={r.notes} /> : <p className="cl-none">{p.noNotes}</p>}
                      {latest && (
                        <ButtonLink to="/download" variant="primary">
                          <DownloadIcon size={16} aria-hidden className="nudge-down" />
                          {fmt(p.download, { version: r.version })}
                        </ButtonLink>
                      )}
                    </div>
                  </article>
                </li>
              )
            })}
          </ol>
        ) : list ? (
          <EmptyState
            className="card"
            icon={<ScrollText size={18} />}
            title={p.empty.title}
            text={p.empty.text}
            action={
              <ButtonLink href={TELEGRAM_CHANNEL} variant="soft">
                <Send size={15} aria-hidden className="nudge-out" />
                {p.channel}
              </ButtonLink>
            }
          />
        ) : releases.error && !releases.loading ? (
          <EmptyState
            className="card"
            icon={<AlertTriangle size={18} />}
            title={p.error.title}
            text={releases.error.message}
            action={
              <Button variant="soft" onClick={releases.reload}>
                <RefreshCw size={15} aria-hidden className="nudge-spin" />
                {t.actions.retry}
              </Button>
            }
          />
        ) : (
          <Pending label={p.loading} className="cl-pending">
            {[0, 1, 2].map((i) => (
              <div key={i} className="cl-skel">
                <Skeleton width="6rem" height="1.5rem" />
                <div className="cl-skel-lines">
                  <Skeleton width="90%" />
                  <Skeleton width="75%" />
                  <Skeleton width="60%" />
                </div>
              </div>
            ))}
          </Pending>
        )}
      </div>
    </div>
  )
}
