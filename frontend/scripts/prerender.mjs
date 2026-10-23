// Build step 3 of 3 (after tsc and the client + server Vite builds): render every public
// route in both locales to dist/<path>/index.html, keep the SPA shell as dist/app.html,
// write the 404 pages, sitemap.xml and robots.txt. Data that changes between releases
// (version, changelog, tiers) is fetched on the client; the HTML carries its static shell.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const ssr = await import(pathToFileURL(path.join(root, 'dist-ssr', 'entry-server.js')).href)
const { render, appShellHeadHtml, PRERENDER_PATHS, LOCALES, localizedPath, SITE_URL } = ssr

const template = await fs.readFile(path.join(dist, 'index.html'), 'utf8')
if (!template.includes('<!--ssr-head-->') || !template.includes('<div id="root"></div>')) {
  throw new Error('dist/index.html lacks the <!--ssr-head--> or #root placeholder')
}
// The SPA shell for cabinet, admin and auth routes (nginx): generic head, noindex.
await fs.writeFile(path.join(dist, 'app.html'), template.replace(/<title>[^<]*<\/title>\s*<!--ssr-head-->/, appShellHeadHtml()))

function page(url) {
  const { html, head, lang } = render(url)
  return template
    .replace('<html lang="ru">', `<html lang="${lang}">`)
    .replace(/<title>[^<]*<\/title>\s*<!--ssr-head-->/, head)
    .replace('<div id="root"></div>', `<div id="root">${html}</div>`)
}

async function write(rel, content) {
  const file = path.join(dist, rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
  const title = content.match(/<title[^>]*>([^<]*)<\/title>/)?.[1]
  console.log(`  ${rel.padEnd(28)} ${title}`)
}

console.log('prerender:')
const urls = []
for (const locale of LOCALES) {
  for (const p of PRERENDER_PATHS) {
    const url = localizedPath(p, locale)
    urls.push({ p, url })
    await write(url === '/' ? 'index.html' : `${url.slice(1)}/index.html`, page(url))
  }
  const notFound = localizedPath('/404', locale)
  await write(locale === 'ru' ? '404.html' : 'en/404.html', page(notFound))
}

const alt = (p) =>
  [...LOCALES.map((l) => [l, localizedPath(p, l)]), ['x-default', localizedPath(p, 'ru')]]
    .map(([l, u]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}${u}"/>`)
    .join('\n')
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.map(({ p, url }) => `  <url>\n    <loc>${SITE_URL}${url}</loc>\n${alt(p)}\n  </url>`).join('\n')}
</urlset>
`
await write('sitemap.xml', sitemap)

const robots = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /account
Disallow: /admin
Disallow: /en/account
Disallow: /en/admin

Sitemap: ${SITE_URL}/sitemap.xml
`
await write('robots.txt', robots)
