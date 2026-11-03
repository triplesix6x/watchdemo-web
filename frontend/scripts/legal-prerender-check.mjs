// Coordinator only, after npm run build:mock. Pure filesystem assertions; no server or network.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const catalog = JSON.parse(await fs.readFile(new URL('src/content/legal.generated.json', root), 'utf8'))
const sitemap = await fs.readFile(new URL('dist/sitemap.xml', root), 'utf8')
assert.ok(catalog.documents.every(d => d.status === 'draft'), 'Draft-release QA only')
assert.doesNotMatch(sitemap, /<loc>[^<]*\/(?:en\/)?legal(?:\/|<)/, 'Draft legal URLs excluded from sitemap')
const escaped = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
for (const locale of ['', '/en']) {
  const hub = await fs.readFile(new URL(`dist${locale}/legal/index.html`, root), 'utf8')
  assert.match(hub, /<meta[^>]*name="robots"[^>]*content="noindex"/)
  for (const doc of catalog.documents) for (const route of [`/legal/${doc.id}`, doc.url]) {
    const html = await fs.readFile(new URL(`dist${locale}${route}/index.html`, root), 'utf8')
    assert.match(html, /<meta[^>]*name="robots"[^>]*content="noindex"/)
    assert.ok(html.includes(`class="legal-body">${escaped(doc.body)}</div>`), `${locale}${route}: full exact Russian body prerendered`)
    assert.ok(html.includes(doc.sha256), `${locale}${route}: hash rendered`)
  }
}
console.log('legal prerender: both locales/hub/latest/versions/full body/noindex/sitemap exclusion: ok')
