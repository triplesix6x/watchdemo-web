// Structured data builders for <Head jsonLd={...} />.
import { SITE_URL } from '../config'
import { dictFor, localizedPath, type Locale } from '../i18n'

/** SoftwareApplication for the home and download pages (SPEC §5). */
export function softwareAppLd(locale: Locale, release?: { version: string; file_size?: number } | null) {
  const t = dictFor(locale)
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'WatchDemo',
    description: t.meta.defaultDescription,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Windows 10, Windows 11',
    url: SITE_URL + localizedPath('/', locale),
    downloadUrl: SITE_URL + localizedPath('/download', locale),
    inLanguage: locale,
    ...(release ? { softwareVersion: release.version } : {}),
  }
}
