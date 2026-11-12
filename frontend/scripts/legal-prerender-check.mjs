// Coordinator only, after npm run build. Checks emitted HTML, not route source text.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const catalog = JSON.parse(await fs.readFile(new URL('src/content/legal.generated.json', root), 'utf8'))
const sitemap = await fs.readFile(new URL('dist/sitemap.xml', root), 'utf8')
assert.doesNotMatch(sitemap, /<loc>[^<]*\/(?:en\/)?legal(?:\/|<)/, 'Cookie information is noindex; hidden documents must not be advertised')
for (const locale of ['', '/en']) {
  const cookie = await fs.readFile(new URL(`dist${locale}/legal/cookies/index.html`, root), 'utf8')
  assert.match(cookie, /<meta[^>]*name="robots"[^>]*content="noindex"/)
  assert.ok(cookie.includes(locale ? 'No optional analytics' : 'Без необязательной аналитики'), 'Factual cookies information must be prerendered')
  assert.doesNotMatch(cookie, /\[\[|\/legal\/(?:terms|privacy|offer|details)|zeroikins/)
  const hidden = new Set(['/legal', ...catalog.documents.flatMap(doc => [`/legal/${doc.id}`, doc.url])])
  hidden.delete('/legal/cookies')
  for (const route of hidden) {
    await assert.rejects(fs.access(new URL(`dist${locale}${route}/index.html`, root)), { code: 'ENOENT' }, `${locale}${route}: stale hidden prerender must not exist`)
  }
}
console.log('legal prerender: factual cookies in both locales, no hidden/stale documents or sitemap exposure: ok')
