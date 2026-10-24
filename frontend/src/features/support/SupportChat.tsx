// The customer's support chat at the bottom of the Help page. Client-only: Help is
// prerendered for guests, and this block exists only for a signed-in user.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supportApi } from '../../api/endpoints'
import type { SupportMessage } from '../../api/types'
import { ApiError } from '../../api/errors'
import { useLocale, useT } from '../../i18n'
import { formatDateTime } from '../../lib/format'
import { usePoll } from '../../lib/usePoll'
import { DelayedReveal, LoadError, Skeleton, useToast } from '../../ui'
import type helpRu from '../../i18n/pages/help.ru'
import { Composer } from './Composer'
import { SupportImage } from './SupportImage'
import './support.css'

type Labels = (typeof helpRu)['chat']

/** New messages win over what we have; the server may repeat recent ones. */
function merge(have: SupportMessage[], incoming: SupportMessage[]): SupportMessage[] {
  if (!incoming.length) return have
  const byId = new Map(have.map((m) => [m.id, m]))
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
}

export default function SupportChat({ labels }: { labels: Labels }) {
  const t = useT()
  const locale = useLocale()
  const toast = useToast()
  const [messages, setMessages] = useState<SupportMessage[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const logRef = useRef<HTMLOListElement>(null)
  const lastId = messages?.length ? messages[messages.length - 1].id : undefined

  const load = useCallback(() => {
    supportApi.messages().then(
      (list) => (setMessages(list), setError(null)),
      (e: ApiError) => setError(e),
    )
  }, [])
  useEffect(load, [load])
  usePoll(() => {
    if (messages) supportApi.messages(lastId).then((list) => setMessages((have) => merge(have ?? [], list)), () => {})
  }, 10_000)

  // Keep the newest message in view when the log grows.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages?.length])

  const send = async (body: string, image: File | null) => {
    try {
      const m = await supportApi.send(body, image)
      setMessages((have) => merge(have ?? [], [m]))
      return true
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t.errors.unknown, { tone: 'error' })
      return false
    }
  }

  return (
    <section className="sp-chat card" id="support-chat" aria-labelledby="support-chat-title">
      <header className="sp-chat-head">
        <h2 id="support-chat-title">{labels.title}</h2>
        <p>{labels.lead}</p>
      </header>
      {error && !messages ? (
        <LoadError text={error.message} onRetry={load} className="" />
      ) : !messages ? (
        <DelayedReveal className="sp-chat-skel">
          <Skeleton height="2.5rem" width="60%" />
          <Skeleton height="2.5rem" width="45%" />
        </DelayedReveal>
      ) : messages.length === 0 ? (
        <p className="sp-chat-empty">{labels.empty}</p>
      ) : (
        <ol className="sp-log" ref={logRef} role="log" aria-label={labels.log} tabIndex={0}>
          {messages.map((m) => (
            <li key={m.id} className="sp-msg" data-side={m.direction === 'in' ? 'me' : 'them'}>
              <p className="sp-msg-meta">
                <span>{m.direction === 'in' ? labels.you : labels.support}</span>
                <time dateTime={m.created_at}>{formatDateTime(m.created_at, locale)}</time>
              </p>
              {m.body && <p className="sp-msg-body">{m.body}</p>}
              {m.image_url && <SupportImage url={m.image_url} alt={labels.imageAlt} />}
            </li>
          ))}
        </ol>
      )}
      <Composer
        labels={{ label: labels.label, send: labels.send, attach: labels.attach, removeImage: labels.removeImage, hint: labels.hint }}
        onSend={send}
        disabled={!messages}
      />
    </section>
  )
}
