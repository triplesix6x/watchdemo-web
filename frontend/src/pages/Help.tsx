import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, ChevronDown, SearchX } from 'lucide-react'
import { fmt, useDict } from '../i18n'
import ru from '../i18n/pages/help.ru'
import en from '../i18n/pages/help.en'
import { Head } from '../head/Head'
import { Button, ButtonLink, EmptyState, Field, Input, Markdown } from '../ui'
import { SUPPORT_BOT_URL } from '../config'
import { useAuth } from '../context/AuthContext'
import { notesToPlain } from '../lib/notes'
import '../features/help/help.css'

type Dict = typeof ru

// Client-only and signed-in only: the prerendered page never contains it, and guests never load it.
const SupportChat = lazy(() => import('../features/support/SupportChat'))

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е')

/** Every answer with its searchable plain text (question, answer, key table). */
function buildIndex(p: Dict) {
  const keysText = p.keys.rows.map((r) => `${r.key} ${r.action}`).join(' ')
  return p.sections.map((s) => ({
    ...s,
    items: s.items.map((it) => {
      const plain = notesToPlain(it.a) + (it.id === 'hotkeys' ? ' ' + keysText : '')
      return { ...it, plain, haystack: norm(`${it.q} ${plain} ${s.title}`) }
    }),
  }))
}

function faqLd(index: ReturnType<typeof buildIndex>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: index.flatMap((s) =>
      s.items.map((it) => ({ '@type': 'Question', name: it.q, acceptedAnswer: { '@type': 'Answer', text: it.plain } })),
    ),
  }
}

/** The id in the URL hash; follows in-page anchor clicks and back/forward. */
function useHashId() {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const sync = () => setId(decodeURIComponent(location.hash.slice(1)) || null)
    sync()
    addEventListener('hashchange', sync)
    return () => removeEventListener('hashchange', sync)
  }, [])
  return id
}

/** The section being read: the last one whose top has passed the upper third of the
 *  viewport. Marks the table of contents while scrolling. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string | null>(null)
  const key = ids.join(' ')
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el)
    if (!els.length) return
    const pick = () => {
      const line = innerHeight / 3
      let cur: string | null = els[0].id
      for (const el of els) if (el.getBoundingClientRect().top <= line) cur = el.id
      setActive(cur)
    }
    // Crossing events from a band at the top third; the pick itself reads the layout.
    const io = new IntersectionObserver(pick, { rootMargin: '0px 0px -66% 0px' })
    els.forEach((el) => io.observe(el.closest('section') ?? el))
    pick()
    return () => io.disconnect()
  }, [key])
  return active
}

export default function Help() {
  const p = useDict({ ru, en })
  const index = useMemo(() => buildIndex(p), [p])
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const hashId = useHashId()

  const q = norm(query.trim())
  const visible = q ? index.map((s) => ({ ...s, items: s.items.filter((it) => it.haystack.includes(q)) })).filter((s) => s.items.length) : index
  const found = visible.reduce((n, s) => n + s.items.length, 0)
  const active = useActiveSection(visible.map((s) => s.id))
  const { user } = useAuth()

  return (
    <div className="container pp hp">
      <Head title={p.meta.title} description={p.meta.description} jsonLd={faqLd(index)} />
      <header className="pp-head">
        <h1>{p.h1}</h1>
        <p className="t-lead">{p.lead}</p>
      </header>

      <div className="hp-grid">
        <div className="hp-aside">
          <div className="hp-search" role="search">
            <Field label={p.search} hint={p.searchHint}>
              <Input ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            </Field>
            <p className="hp-found" role="status">
              {q ? fmt(p.found, { count: found }) : ''}
            </p>
          </div>
          <nav className="hp-toc" aria-label={p.toc}>
            <ul role="list">
              {visible.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} aria-current={active === s.id ? 'location' : undefined}>
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="hp-ask card">
            <p className="hp-ask-title">{p.askTitle}</p>
            <p className="hp-ask-text">{p.askText}</p>
            {user ? (
              <a href="#support-chat" className="btn btn-primary">
                {p.askChat}
              </a>
            ) : (
              <ButtonLink href={SUPPORT_BOT_URL} variant="primary">
                {p.ask}
                <ArrowUpRight size={16} aria-hidden className="nudge-out" />
              </ButtonLink>
            )}
          </div>
        </div>

        <div className="hp-main">
          {visible.length ? (
            visible.map((s) => (
              <section key={s.id} className="hp-section" aria-labelledby={s.id}>
                <h2 id={s.id} className="hp-h2">
                  {s.title}
                </h2>
                <div className="hp-items">
                  {s.items.map((it) => (
                    // Open while searching, or when the URL points at it; otherwise the reader decides.
                    <details key={it.id} id={it.id} className="disclosure hp-item" open={q !== '' || hashId === it.id || undefined}>
                      <summary>
                        {it.q}
                        <ChevronDown size={16} aria-hidden className="disclosure-chevron" />
                      </summary>
                      <div className="disclosure-body">
                        <Markdown text={it.a} heading={4} />
                        {it.id === 'hotkeys' && <KeysTable p={p} />}
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <EmptyState
              className="card"
              icon={<SearchX size={18} />}
              title={fmt(p.noResults.title, { query: query.trim() })}
              text={p.noResults.text}
              action={
                <Button
                  variant="soft"
                  onClick={() => {
                    setQuery('')
                    searchRef.current?.focus()
                  }}
                >
                  {p.noResults.reset}
                </Button>
              }
            />
          )}
          {user && (
            <Suspense fallback={null}>
              <SupportChat labels={p.chat} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  )
}

function KeysTable({ p }: { p: Dict }) {
  return (
    <table className="hp-keys">
      <caption>{p.keys.caption}</caption>
      <thead>
        <tr>
          <th scope="col">{p.keys.key}</th>
          <th scope="col">{p.keys.action}</th>
        </tr>
      </thead>
      <tbody>
        {p.keys.rows.map((r) => (
          <tr key={r.key}>
            <td>
              <kbd>{r.key}</kbd>
            </td>
            <td>{r.action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
