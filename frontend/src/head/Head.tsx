// Per-page <head>: title, description, canonical, hreflang, Open Graph, Twitter, JSON-LD.
// Render <Head .../> once in a page component. On the server (prerender) the data is
// collected into HeadCollector and serialized into the HTML; in the browser an effect
// rewrites the tags marked data-head.
import { createContext, useContext, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { DEFAULT_OG_IMAGE, SITE_URL } from '../config'
import { dictFor, localizedPath, splitLocale, type Locale } from '../i18n'

export type HeadProps = {
  /** Page name; " · WatchDemo" is appended. Omit on the home page to use the default title. */
  title?: string
  description?: string
  /** Absolute or root-relative image, 1200x630 ideally. */
  image?: string
  /** Keep the page out of search (cabinet, admin, auth flows, 404). */
  noindex?: boolean
  /** Structured data, e.g. a SoftwareApplication object. Rendered as JSON-LD. */
  jsonLd?: object | object[]
  type?: 'website' | 'article'
}

type Resolved = HeadProps & { locale: Locale; path: string }
/** Server-side sink. The prerender wraps the app in it and reads `.data` after render. */
export const HeadCollector = createContext<{ data: Resolved | null } | null>(null)

type Tag = { tag: 'title' | 'meta' | 'link' | 'script'; attrs: Record<string, string>; text?: string }

const abs = (url: string) => (url.startsWith('http') ? url : SITE_URL + url)
const OG_LOCALE: Record<Locale, string> = { ru: 'ru_RU', en: 'en_US' }

export function headTags(h: Resolved): Tag[] {
  const t = dictFor(h.locale)
  const title = h.title ? `${h.title} · ${t.meta.siteName}` : t.meta.defaultTitle
  const description = h.description ?? t.meta.defaultDescription
  const url = SITE_URL + localizedPath(h.path, h.locale)
  const image = abs(h.image ?? DEFAULT_OG_IMAGE)
  const other: Locale = h.locale === 'ru' ? 'en' : 'ru'
  const tags: Tag[] = [
    { tag: 'title', attrs: {}, text: title },
    { tag: 'meta', attrs: { name: 'description', content: description } },
    { tag: 'link', attrs: { rel: 'canonical', href: url } },
    { tag: 'link', attrs: { rel: 'alternate', hreflang: 'ru', href: SITE_URL + localizedPath(h.path, 'ru') } },
    { tag: 'link', attrs: { rel: 'alternate', hreflang: 'en', href: SITE_URL + localizedPath(h.path, 'en') } },
    { tag: 'link', attrs: { rel: 'alternate', hreflang: 'x-default', href: SITE_URL + localizedPath(h.path, 'ru') } },
    { tag: 'meta', attrs: { property: 'og:type', content: h.type ?? 'website' } },
    { tag: 'meta', attrs: { property: 'og:site_name', content: t.meta.siteName } },
    { tag: 'meta', attrs: { property: 'og:title', content: title } },
    { tag: 'meta', attrs: { property: 'og:description', content: description } },
    { tag: 'meta', attrs: { property: 'og:url', content: url } },
    { tag: 'meta', attrs: { property: 'og:image', content: image } },
    { tag: 'meta', attrs: { property: 'og:locale', content: OG_LOCALE[h.locale] } },
    { tag: 'meta', attrs: { property: 'og:locale:alternate', content: OG_LOCALE[other] } },
    { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
    { tag: 'meta', attrs: { name: 'twitter:title', content: title } },
    { tag: 'meta', attrs: { name: 'twitter:description', content: description } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: image } },
  ]
  if (h.noindex) tags.push({ tag: 'meta', attrs: { name: 'robots', content: 'noindex' } })
  for (const ld of h.jsonLd ? ([] as object[]).concat(h.jsonLd) : []) {
    // "<" escaped so a string inside the data cannot close the script element.
    tags.push({ tag: 'script', attrs: { type: 'application/ld+json' }, text: JSON.stringify(ld).replace(/</g, '\\u003c') })
  }
  return tags
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Serialize for the prerender. Every tag carries data-head so the client can replace it. */
export function headToHtml(h: Resolved): string {
  return headTags(h)
    .map(({ tag, attrs, text }) => {
      const a = Object.entries({ ...attrs, 'data-head': '' })
        .map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${esc(v)}"`))
        .join('')
      if (tag === 'meta' || tag === 'link') return `<${tag}${a}>`
      return `<${tag}${a}>${tag === 'script' ? text : esc(text ?? '')}</${tag}>`
    })
    .join('\n    ')
}

/** Head of app.html, the shell nginx serves for auth, cabinet and admin URLs in both
 *  locales: generic and noindex. Each page's <Head> replaces it once it renders. */
export function appShellHeadHtml(): string {
  const t = dictFor('ru')
  return [
    `<title data-head>${esc(t.meta.appTitle)}</title>`,
    `<meta name="description" content="${esc(t.meta.appDescription)}" data-head>`,
    '<meta name="robots" content="noindex" data-head>',
  ].join('\n    ')
}

function applyHead(h: Resolved) {
  document.head.querySelectorAll('[data-head]').forEach((el) => el.remove())
  for (const { tag, attrs, text } of headTags(h)) {
    if (tag === 'title') {
      document.title = text ?? ''
      continue
    }
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    el.setAttribute('data-head', '')
    if (text) el.textContent = text
    document.head.appendChild(el)
  }
}

export function Head(props: HeadProps) {
  const collector = useContext(HeadCollector)
  const { locale, path } = splitLocale(useLocation().pathname)
  const data: Resolved = { ...props, locale, path }
  if (collector) collector.data = data
  const key = JSON.stringify(data)
  useEffect(() => {
    applyHead(JSON.parse(key) as Resolved)
  }, [key])
  return null
}
