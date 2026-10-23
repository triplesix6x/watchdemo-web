import { createElement, useMemo } from 'react'
import { LocalLink } from '../i18n'
import { parseNotes, type Inline } from '../lib/notes'

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((x, i) => {
        if (x.t === 'strong') return <strong key={i}>{x.v}</strong>
        if (x.t === 'code') return <code key={i}>{x.v}</code>
        if (x.t === 'link')
          return x.href.startsWith('/') ? (
            <LocalLink key={i} to={x.href} className="link">
              {x.v}
            </LocalLink>
          ) : (
            <a key={i} href={x.href} className="link" target="_blank" rel="noopener noreferrer">
              {x.v}
            </a>
          )
        return x.v
      })}
    </>
  )
}

/** Renders the notes markup (see notes.ts) as elements. `heading` is the level the
 *  surrounding outline leaves free for "#" lines. */
export function Markdown({ text, heading = 3, className = '' }: { text: string; heading?: 3 | 4; className?: string }) {
  const blocks = useMemo(() => parseNotes(text), [text])
  return (
    <div className={`md ${className}`}>
      {blocks.map((b, i) => {
        if (b.t === 'h') return createElement(`h${heading}`, { key: i, className: 'md-h' }, <Inlines items={b.v} />)
        if (b.t === 'p')
          return (
            <p key={i}>
              <Inlines items={b.v} />
            </p>
          )
        const List = b.t
        return (
          <List key={i}>
            {b.items.map((item, j) => (
              <li key={j}>
                <Inlines items={item} />
              </li>
            ))}
          </List>
        )
      })}
    </div>
  )
}
