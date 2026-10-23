// Run: node src/features/admin/access.check.ts
import assert from 'node:assert/strict'
import { can, canOnUser } from './access.ts'

const admin = { id: 'a', role: 'admin' as const }
const admin2 = { id: 'a2', role: 'admin' as const }
const mod = { id: 'm', role: 'moderator' as const }
const mod2 = { id: 'm2', role: 'moderator' as const }
const support = { id: 's', role: 'support' as const }
const user = { id: 'u', role: 'user' as const }

assert.equal(canOnUser(mod, user, 'setActive'), true, 'moderator disables a user')
assert.equal(canOnUser(mod, mod2, 'setActive'), false, 'moderator cannot touch an equal role')
assert.equal(canOnUser(admin, admin2, 'setActive'), true, 'admin may touch another admin')
assert.equal(canOnUser(admin, admin, 'revokeSessions'), false, 'never yourself (strict)')
assert.equal(canOnUser(mod, mod2, 'beta'), true, 'beta allows an equal role')
assert.equal(canOnUser(mod, admin, 'verify'), false, 'verify refuses a higher role')
assert.equal(canOnUser(support, user, 'subscription'), false, 'support is read-only')
assert.equal(canOnUser(mod, admin, 'subscription'), true, 'subscriptions have no target rule')
assert.equal(canOnUser(mod, user, 'role'), false, 'only admins change roles')
assert.equal(canOnUser(admin, admin, 'role'), false, 'admin does not demote themselves here')
assert.equal(canOnUser(null, user, 'beta'), false)
assert.equal(can('moderator', 'viewReleases'), true)
assert.equal(can('moderator', 'manageReleases'), false)
assert.equal(can('admin', 'viewAudit'), true)
assert.equal(can('support', 'moderate'), false)
assert.equal(can(undefined, 'viewReleases'), false)
console.log('access: ok')
