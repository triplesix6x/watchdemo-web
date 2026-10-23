// i18n: Russian at unprefixed paths, English under /en. The locale is read from the URL,
// so the server render, the client and every link agree without extra state.
import { forwardRef, useEffect } from 'react'
import { Link, useLocation, type LinkProps } from 'react-router-dom'
import { ru, type Dict } from './ru'
import { en } from './en'
import { setApiLocale } from '../api/client'

export type Locale = 'ru' | 'en'
export const LOCALES: readonly Locale[] = ['ru', 'en']
export const DEFAULT_LOCALE: Locale = 'ru'
const dicts: Record<Locale, Dict> = { ru, en }

/** '/en/download' -> { locale: 'en', path: '/download' }; '/download' -> { locale: 'ru', ... }. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  if (pathname === '/en' || pathname.startsWith('/en/')) {
    return { locale: 'en', path: pathname.slice(3) || '/' }
  }
  return { locale: 'ru', path: pathname || '/' }
}

/** Unprefixed path (may carry ?query and #hash) to the path for `locale`. */
export function localizedPath(path: string, locale: Locale): string {
  if (!path.startsWith('/')) return path // external or relative: leave alone
  if (locale === DEFAULT_LOCALE) return path
  const cut = path.search(/[?#]/)
  const pathname = cut < 0 ? path : path.slice(0, cut)
  const rest = cut < 0 ? '' : path.slice(cut)
  return (pathname === '/' ? '/en' : `/en${pathname}`) + rest
}

export const dictFor = (locale: Locale): Dict => dicts[locale]

export function useLocale(): Locale {
  return splitLocale(useLocation().pathname).locale
}

/** Shared strings for the current locale: `const t = useT(); t.nav.download`. */
export function useT(): Dict {
  return dicts[useLocale()]
}

/** Page strings: `const p = useDict({ ru, en })` with the two files from i18n/pages. */
export function useDict<T>(d: { ru: T; en: T }): T {
  return d[useLocale()]
}

/** Localize an unprefixed path for the current locale: `lp('/download')`. */
export function useLp(): (path: string) => string {
  const locale = useLocale()
  return (path) => localizedPath(path, locale)
}

export { fmt } from './fmt'

const pluralRules: Record<Locale, Intl.PluralRules> = {
  ru: new Intl.PluralRules('ru'),
  en: new Intl.PluralRules('en'),
}
/** plural('ru', 5, { one: 'демка', few: 'демки', many: 'демок' }) -> 'демок'. `other` is the fallback. */
export function plural(
  locale: Locale,
  n: number,
  forms: { one: string; few?: string; many?: string; other?: string },
): string {
  const cat = pluralRules[locale].select(n) as keyof typeof forms
  return forms[cat] ?? forms.other ?? forms.many ?? forms.one
}

/** A router Link whose `to` is an unprefixed path, localized for the current locale. */
export const LocalLink = forwardRef<HTMLAnchorElement, Omit<LinkProps, 'to'> & { to: string }>(
  function LocalLink({ to, ...rest }, ref) {
    const lp = useLp()
    return <Link ref={ref} to={lp(to)} {...rest} />
  },
)

/** Keeps <html lang> and the API client's error language in step with the URL. */
export function LocaleSync() {
  const locale = useLocale()
  setApiLocale(locale) // render-time on purpose: the first request of a page already speaks it
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  return null
}

/** RU / EN switch that keeps the current page, query and hash. */
export function LangSwitch({ className = '' }: { className?: string }) {
  const { pathname, search, hash } = useLocation()
  const { locale, path } = splitLocale(pathname)
  const t = dicts[locale]
  return (
    <nav className={`seg lang-switch ${className}`} aria-label={t.lang.label}>
      {LOCALES.map((l) => {
        const label = (
          <>
            {t.lang.short[l]}
            <span className="sr-only"> {dicts[l].lang[l]}</span>
          </>
        )
        // The current language is a marker, not a link back to the same page.
        return l === locale ? (
          <span key={l} className="seg-item" lang={l} aria-current="true">
            {label}
          </span>
        ) : (
          <Link key={l} to={localizedPath(path, l) + search + hash} className="seg-item" hrefLang={l} lang={l}>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
