// Run by the coordinator only: node src/features/legal/signupPolicy.check.ts
import assert from 'node:assert/strict'
import { displayedTerms, legalAcceptance, parseSignupPolicy } from './signupPolicy.ts'
import type { LegalDocument } from './catalog.ts'

const sha256 = 'a'.repeat(64)
const draft = parseSignupPolicy({ mode: 'draft', policy_id: null, catalog_sha256: sha256, required_terms: null, privacy_url: '/legal/privacy' })
const wire = { mode: 'enforced', policy_id: 'policy-fixture-1', catalog_sha256: sha256,
  required_terms: { document_id: 'terms', revision: 'fixture-effective-1', sha256, url: '/legal/terms/fixture-effective-1' }, privacy_url: '/legal/privacy' }
const enforced = parseSignupPolicy(wire)
const doc: LegalDocument = { id: 'terms', revision: 'fixture-effective-1', status: 'effective', language: 'ru', title: 'Тестовая редакция',
  published_at: '2026-11-03', effective_at: '2026-11-03', body: 'Fixture only, never published.', sha256, url: '/legal/terms/fixture-effective-1' }
assert.equal(displayedTerms(draft, [doc]), undefined)
assert.equal(legalAcceptance(draft, true, [doc]), undefined, 'drafts are never accepted')
assert.equal(displayedTerms(enforced, [doc]), doc)
assert.equal(legalAcceptance(enforced, false, [doc]), undefined, 'the box is not prechecked')
assert.deepEqual(legalAcceptance(enforced, true, [doc]), { policy_id: 'policy-fixture-1', terms_revision: doc.revision, terms_sha256: sha256, accepted: true }, 'exact contract payload, no privacy/age/Resend consent')
for (const changed of [{ ...doc, status: 'draft' as const }, { ...doc, sha256: 'b'.repeat(64) }, { ...doc, revision: 'older' }, { ...doc, url: '/legal/terms/wrong' }, { ...doc, id: 'privacy' }]) {
  assert.equal(displayedTerms(enforced, [changed]), undefined)
  assert.equal(legalAcceptance(enforced, true, [changed]), undefined, 'mismatched or draft displayed text blocks acceptance')
}
assert.equal(legalAcceptance(enforced, true, []), undefined, 'missing bundled revision fails closed')
assert.equal(displayedTerms(parseSignupPolicy({ ...wire, required_terms: { ...wire.required_terms, url: '/en/legal/terms/fixture-effective-1' } }), [doc]), doc)
for (const invalid of [null, {}, { ...wire, mode: 'future' }, { ...wire, policy_id: null }, { ...wire, required_terms: null },
  { ...wire, privacy_url: 'https://example.com/legal/privacy' }, { ...wire, required_terms: { ...wire.required_terms, url: 'javascript:alert(1)' } },
  { ...wire, required_terms: { ...wire.required_terms, sha256: 'not-a-hash' } }, { ...wire, mode: 'draft' }]) {
  assert.throws(() => parseSignupPolicy(invalid), /Invalid signup policy/)
}
console.log('signupPolicy: draft/enforced/exact payload/mismatched text/unsafe boundary: ok')
