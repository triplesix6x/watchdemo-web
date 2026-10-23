// Release notes and help answers are plain text with a little markup: blank lines between
// paragraphs, "- " / "1. " lists, "#" headings, **bold**, `code` and [text](url).
// parseNotes turns it into data that React renders as elements, so nothing the admin
// typed ever reaches the page as HTML.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; v: string }
  | { t: 'code'; v: string }
  | { t: 'link'; v: string; href: string }

export type Block =
  | { t: 'p'; v: Inline[] }
  | { t: 'h'; v: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g
// Site paths and web links only: "javascript:" and friends stay text, and so do "//host"
// and "/\host", which browsers read as links to another site.
const SAFE_HREF = /^(\/(?![/\\])|https?:\/\/)/i

export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of s.matchAll(INLINE)) {
    const [all, bold, code, label, href] = m
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) })
    if (bold !== undefined) out.push({ t: 'strong', v: bold })
    else if (code !== undefined) out.push({ t: 'code', v: code })
    else if (SAFE_HREF.test(href)) out.push({ t: 'link', v: label, href })
    else out.push({ t: 'text', v: all })
    last = m.index + all.length
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) })
  return out
}

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const HEADING = /^#{1,6}\s+(.*)$/

export function parseNotes(text: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: { t: 'ul' | 'ol'; items: string[] } | null = null
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', v: parseInline(para.join(' ')) })
    if (list) blocks.push({ t: list.t, items: list.items.map(parseInline) })
    para = []
    list = null
  }
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    const bullet = BULLET.exec(raw)
    const numbered = bullet ? null : NUMBERED.exec(raw)
    const heading = HEADING.exec(line)
    if (!line) flush()
    else if (heading) {
      flush()
      blocks.push({ t: 'h', v: parseInline(heading[1]) })
    } else if (bullet || numbered) {
      const t = bullet ? 'ul' : 'ol'
      if (para.length || (list && list.t !== t)) flush()
      list ??= { t, items: [] }
      list.items.push((bullet ?? numbered)![1].trim())
    } else if (list && /^\s/.test(raw)) {
      // An indented line continues the previous list item.
      list.items[list.items.length - 1] += ' ' + line
    } else {
      if (list) flush()
      para.push(line)
    }
  }
  flush()
  return blocks
}

const inlineText = (xs: Inline[]) => xs.map((x) => x.v).join('')

/** The text without markup, for search and JSON-LD. */
export function notesToPlain(text: string): string {
  return parseNotes(text)
    .map((b) => ('items' in b ? b.items.map(inlineText).join('; ') : inlineText(b.v)))
    .join(' ')
}

/** Anchor id of a version on the changelog: "0.8.0-beta.2" -> "v0-8-0-beta-2". No dots,
 *  so "#id" stays a valid selector for the engine's scrollToTarget. */
export const versionAnchor = (version: string) => 'v' + version.replace(/[^a-z0-9]+/gi, '-')
