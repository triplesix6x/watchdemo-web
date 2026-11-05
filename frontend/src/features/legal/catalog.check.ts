// Run by the coordinator after copying generated files: node src/features/legal/catalog.check.ts
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'

const catalog = JSON.parse(fs.readFileSync(new URL('../../content/legal.generated.json', import.meta.url), 'utf8'))
const manifest = JSON.parse(fs.readFileSync(new URL('../../../public/legal/catalog-manifest.json', import.meta.url), 'utf8'))
const digest = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => [key, sorted(v)]))
  return value
}
const { catalog_sha256, ...payload } = catalog
assert.equal(digest(JSON.stringify(sorted(payload))), catalog_sha256, 'canonical payload hash')
assert.equal(catalog.schema_version, 1)
assert.deepEqual(catalog.release, { sequence: 0, effective_at: null, legal_review_approved: false, evidence_retention_days: null })
assert.deepEqual(catalog.documents.map((d: { id: string }) => d.id).sort(), ['cookies', 'details', 'offer', 'privacy', 'terms'])
for (const d of catalog.documents) {
  assert.equal(d.status, 'draft')
  assert.equal(d.language, 'ru')
  assert.equal(d.effective_at, null)
  assert.equal(d.revision, '2026-11-03-draft-1')
  assert.equal(d.url, `/legal/${d.id}/${d.revision}`)
  assert.equal(digest(d.body), d.sha256, `${d.id}: exact UTF-8 body, including final LF`)
}
assert.deepEqual(manifest, { schema_version: 1, catalog_sha256, release_sequence: 0,
  documents: catalog.documents.map(({ id, revision, sha256, url }: { id: string; revision: string; sha256: string; url: string }) => ({ id, revision, sha256, url })) })
console.log('catalog: draft release/exact body hashes/canonical hash/manifest parity: ok')
