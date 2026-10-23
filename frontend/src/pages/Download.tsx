import { AlertTriangle, ChevronDown, Download as DownloadIcon, Megaphone, RefreshCw, Send } from 'lucide-react'
import { fmt, LocalLink, useDict, useLocale, useT } from '../i18n'
import ru from '../i18n/pages/download.ru'
import en from '../i18n/pages/download.en'
import { Head } from '../head/Head'
import { softwareAppLd } from '../head/jsonld'
import type { LatestRelease } from '../api/types'
import { useLatestRelease } from '../lib/useLatestRelease'
import { formatBytes, formatDate } from '../lib/format'
import { Button, ButtonLink, CopyButton, EmptyState, Pending, Pill, Skeleton } from '../ui'
import { TELEGRAM_CHANNEL } from '../config'
import { versionAnchor } from '../lib/notes'
import '../features/download/download.css'

type Dict = typeof ru

export default function Download() {
  const t = useT()
  const p = useDict({ ru, en })
  const locale = useLocale()
  const release = useLatestRelease()
  const data = release.loading ? undefined : release.data
  const error = release.loading ? undefined : release.error

  return (
    <div className="container pp dl">
      <Head title={p.meta.title} description={p.meta.description} jsonLd={softwareAppLd(locale, data)} />

      <div className="dl-top">
        <div className="dl-main pp-head">
          <h1>{p.h1}</h1>
          <p className="t-lead">{p.lead}</p>
          <div className="dl-release">
            {data ? (
              <ReleaseCard p={p} r={data} />
            ) : error?.status === 404 ? (
              <EmptyState
                className="card"
                icon={<Megaphone size={18} />}
                title={p.empty.title}
                text={p.empty.text}
                action={
                  <ButtonLink href={TELEGRAM_CHANNEL} variant="soft">
                    <Send size={15} aria-hidden className="nudge-out" />
                    {p.empty.action}
                  </ButtonLink>
                }
              />
            ) : error ? (
              <EmptyState
                className="card"
                icon={<AlertTriangle size={18} />}
                title={p.error.title}
                text={error.message}
                action={
                  <Button variant="soft" onClick={release.reload}>
                    <RefreshCw size={15} aria-hidden className="nudge-spin" />
                    {t.actions.retry}
                  </Button>
                }
              />
            ) : (
              <>
                <Button variant="primary" size="lg" disabled className="dl-cta">
                  <DownloadIcon size={18} aria-hidden className="nudge-down" />
                  {p.cta}
                </Button>
                <Pending label={p.loading} className="dl-meta-pending">
                  <Skeleton width="17rem" height="var(--dl-meta-h)" />
                  <Skeleton width="10rem" height="1.5rem" />
                  <Skeleton className="dl-hash-skel" width="100%" height="var(--dl-hash-h)" />
                </Pending>
              </>
            )}
          </div>
        </div>
        <figure className="dl-shot">
          <img src="/screens/app-home.webp" width={1280} height={800} alt={p.shot} decoding="async" />
        </figure>
      </div>

      <div className="dl-info">
        <section className="dl-install" aria-labelledby="install">
          <h2 id="install" className="pp-h2">
            {p.installTitle}
          </h2>
          <ol className="dl-steps" role="list">
            {p.install.map((step, i) => (
              <li key={i}>
                <span className="dl-step-n num" aria-hidden="true">
                  {i + 1}
                </span>
                <p>
                  {step}
                  {i === p.install.length - 1 && (
                    <>
                      {' '}
                      {p.noAccount}{' '}
                      <LocalLink to="/register" className="link">
                        {p.register}
                      </LocalLink>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="dl-req" aria-labelledby="requirements">
          <h2 id="requirements" className="pp-h2">
            {p.reqTitle}
          </h2>
          <dl>
            {p.req.map((r) => (
              <div key={r.term}>
                <dt>{r.term}</dt>
                <dd>{r.text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="dl-update" aria-labelledby="updates">
          <h2 id="updates" className="pp-h2">
            {p.updateTitle}
          </h2>
          <p>{p.updateText}</p>
          <LocalLink to="/changelog" className="link">
            {p.allReleases}
          </LocalLink>
        </section>
      </div>
    </div>
  )
}

function ReleaseCard({ p, r }: { p: Dict; r: LatestRelease }) {
  const locale = useLocale()
  const command = `(Get-FileHash -Algorithm SHA256 .\\${r.file_name}).Hash -eq '${r.sha256}'`
  return (
    <>
      <ButtonLink href={r.url} target="_self" rel={undefined} variant="primary" size="lg" className="dl-cta" download={r.file_name}>
        <DownloadIcon size={18} aria-hidden className="nudge-down" />
        {p.cta}
      </ButtonLink>
      <p className="dl-meta num">
        <span>{fmt(p.version, { version: r.version })}</span>
        <Pill tone={r.channel === 'beta' ? 'warning' : 'neutral'}>{p.channel[r.channel]}</Pill>
        <span aria-hidden="true">·</span>
        <time dateTime={r.published_at}>{formatDate(r.published_at, locale)}</time>
        <span aria-hidden="true">·</span>
        <span>{formatBytes(r.file_size, locale)}</span>
      </p>
      {r.channel === 'beta' && <p className="dl-beta">{p.betaNote}</p>}
      <LocalLink to={`/changelog#${versionAnchor(r.version)}`} className="link dl-changes">
        {fmt(p.changes, { version: r.version })}
      </LocalLink>

      <div className="dl-hash card">
        <div className="dl-hash-row">
          <div className="dl-hash-text">
            <span className="dl-hash-label">{p.sha.label}</span>
            <code className="dl-code">{r.sha256}</code>
          </div>
          <CopyButton text={r.sha256} label={p.sha.copy} />
        </div>
        <details className="disclosure dl-verify">
          <summary>
            {p.sha.howTitle}
            <ChevronDown size={16} aria-hidden className="disclosure-chevron" />
          </summary>
          <div className="disclosure-body">
            <p>{p.sha.howText}</p>
            <pre className="dl-cmd">
              <code>{command}</code>
            </pre>
            <CopyButton text={command} label={p.sha.copyCommand} />
          </div>
        </details>
      </div>
    </>
  )
}
