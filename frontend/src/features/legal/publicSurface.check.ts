import assert from 'node:assert/strict'
import { isPublicLegalPath, legalPaths } from './publicRoutes.ts'

assert.deepEqual(legalPaths, [{ path: '/legal/cookies', noindex: true }])
assert.equal(isPublicLegalPath('/legal/cookies'), true)
for (const path of [
  '/legal', '/legal/', '/legal/terms', '/legal/privacy', '/legal/offer', '/legal/details',
  '/legal/cookies/2026-11-03-draft-1', '/legal/terms/2026-11-03-draft-1',
]) {
  assert.equal(isPublicLegalPath(path), false, `${path} must not render a public legal document`)
}
console.log('public legal route allowlist: ok')
