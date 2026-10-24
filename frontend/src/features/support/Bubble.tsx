// One message in the support chat or the inbox thread. `side="me"` sits on the right.
import type { ReactNode } from 'react'
import { useLocale } from '../../i18n'
import { formatDateTime } from '../../lib/format'
import { SupportImage } from './SupportImage'

export function Bubble({
  side,
  note,
  who,
  at,
  body,
  imageUrl,
  imageAlt,
  edited,
  children,
}: {
  side: 'me' | 'them'
  note?: boolean
  who: string
  at: string
  body: string
  imageUrl: string | null
  imageAlt: string
  /** The "edited" label, when the customer changed the message. */
  edited?: string
  /** Status pills under the message. */
  children?: ReactNode
}) {
  const locale = useLocale()
  return (
    <li className="sp-msg" data-side={side} data-note={note || undefined}>
      <p className="sp-msg-meta">
        <span>{who}</span>
        <time dateTime={at}>{formatDateTime(at, locale)}</time>
        {edited && <span>{edited}</span>}
      </p>
      {body && <p className="sp-msg-body">{body}</p>}
      {imageUrl && <SupportImage url={imageUrl} alt={imageAlt} />}
      {children}
    </li>
  )
}
