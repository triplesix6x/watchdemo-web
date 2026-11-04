import { useLocation } from 'react-router-dom'
import { LocalLink, splitLocale, useLocale } from '../i18n'
import { Head } from '../head/Head'
import { Button, Pill } from '../ui'
import { latestDocument, legalCatalog, legalIds, type LegalDocument } from '../features/legal/catalog'
import NotFound from './NotFound'

function Status({ doc }: { doc: LegalDocument }) {
  const en = useLocale() === 'en'
  return <Pill tone={doc.status === 'draft' ? 'warning' : 'neutral'}>{doc.status === 'draft' ? (en ? 'Draft — not in force' : 'Черновик — не действует') : doc.status === 'effective' ? (en ? 'Effective' : 'Действует') : (en ? 'Archived revision' : 'Архивная редакция')}</Pill>
}

function download(doc: LegalDocument) {
  const url = URL.createObjectURL(new Blob([doc.body], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${doc.id}-${doc.revision}.txt`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function Legal() {
  const en = useLocale() === 'en'
  const { path } = splitLocale(useLocation().pathname)
  const [, , id, revision] = path.split('/')
  const doc = id ? (revision ? legalCatalog.documents.find((d) => d.id === id && d.revision === revision) : latestDocument(id)) : undefined
  if (id && !doc) return <NotFound />
  const title = doc?.title ?? (en ? 'Legal documents' : 'Правовые документы')
  return <div className="container pp legal-page">
    <Head title={title} noindex={doc ? doc.status === 'draft' : legalCatalog.documents.some((d) => d.status === 'draft')} />
    <header className="pp-head">
      {doc && <LocalLink to="/legal" className="link legal-back">← {en ? 'All documents' : 'Все документы'}</LocalLink>}
      <h1 lang={doc ? 'ru' : undefined}>{title}</h1>
      <p className="t-lead">{en ? 'The legal documents are published in Russian. The Russian text is the original; English navigation is provided for convenience.' : 'Документы опубликованы на русском языке. Русский текст является оригиналом.'}</p>
    </header>
    {!doc ? <>
      {legalCatalog.documents.some((d) => d.status === 'draft') && <div className="legal-draft" role="note"><strong>{en ? 'Documents are not yet in force' : 'Документы пока не действуют'}</strong><p>{en ? 'These are drafts. Operator details and other open fields are not yet completed. They are not presented for acceptance.' : 'Это черновики: реквизиты и другие открытые поля ещё не заполнены. Документы не предлагаются для принятия.'}</p></div>}
      <ul className="legal-list card" role="list">{legalIds.map((key) => {
        const latest = latestDocument(key)
        if (!latest) return null
        return <li key={key}><div className="legal-summary"><LocalLink to={`/legal/${key}`} className="legal-title" lang="ru">{latest.title}</LocalLink><span className="t-muted">{en ? 'Revision' : 'Редакция'} {latest.revision}</span></div><Status doc={latest} /></li>
      })}</ul>
    </> : <article>
      <div className="legal-meta"><Status doc={doc} /><dl>
        <div><dt>{en ? 'Revision' : 'Редакция'}</dt><dd>{doc.revision}</dd></div>
        <div><dt>{en ? 'Published' : 'Опубликовано'}</dt><dd>{doc.published_at}</dd></div>
        <div><dt>{en ? 'Effective from' : 'Вступление в силу'}</dt><dd>{doc.effective_at ?? (en ? 'Not set' : 'Не установлено')}</dd></div>
        <div><dt>SHA-256</dt><dd className="legal-hash">{doc.sha256}</dd></div>
      </dl></div>
      {doc.status === 'draft' && <div className="legal-draft" role="note"><strong>{en ? 'Draft document' : 'Черновик документа'}</strong><p>{en ? 'Not in force and not available for acceptance. Unfilled fields are shown as part of the draft.' : 'Не действует и не предлагается для принятия. Незаполненные поля сохранены в тексте черновика.'}</p></div>}
      <div className="legal-actions legal-tools"><LocalLink to={doc.url} className="link">{en ? 'Permanent revision link' : 'Постоянная ссылка на редакцию'}</LocalLink><Button variant="soft" onClick={() => download(doc)}>{en ? 'Download TXT' : 'Скачать TXT'}</Button><Button variant="soft" onClick={() => window.print()}>{en ? 'Print' : 'Печать'}</Button></div>
      <div lang="ru" className="legal-body">{doc.body}</div>
      <nav className="legal-history" aria-label={en ? 'Document revisions' : 'Редакции документа'}><h2>{en ? 'Revisions' : 'Редакции'}</h2><ul>{legalCatalog.documents.filter((d) => d.id === doc.id).map((d) => <li key={d.revision}><LocalLink to={d.url} className="link" aria-current={d.revision === doc.revision ? 'page' : undefined}>{d.revision}</LocalLink> <Status doc={d} /></li>)}</ul></nav>
    </article>}
  </div>
}
