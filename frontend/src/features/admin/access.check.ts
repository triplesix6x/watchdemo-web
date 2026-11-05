// Run by the coordinator only: node src/features/admin/access.check.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ROLES } from '../../api/types.ts'
import { canOnUser, type UserAction } from './access.ts'
import ru from '../../i18n/pages/admin.ru.ts'
import en from '../../i18n/pages/admin.en.ts'

for (const role of ROLES) {
  const actor = { id: 'actor', role }
  assert.equal(canOnUser(actor, actor, 'resetGroups'), false, `${role}: no self reset`)
  for (const targetRole of ROLES) {
    const expected = role !== 'user' && (role === 'admin' || ROLES.indexOf(role) > ROLES.indexOf(targetRole))
    assert.equal(canOnUser(actor, { id: 'target', role: targetRole }, 'resetGroups'), expected, `${role} -> ${targetRole}`)
  }
}
assert.equal(canOnUser(null, { id: 'target', role: 'user' }, 'resetGroups'), false)
const support = { id: 'support', role: 'support' } as const
for (const role of ROLES) {
  for (const action of ['setActive', 'revokeSessions', 'passwordReset', 'beta', 'verify', 'subscription', 'role'] satisfies UserAction[]) {
    assert.equal(canOnUser(support, { id: 'target', role }, action), false, `support still cannot ${action}`)
  }
}

const source = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const endpoint = source('../../api/endpoints.ts')
const mock = source('../../api/mock/index.ts')
// Source wiring only: the role matrix above is behavioral UI policy coverage.
assert.match(mock, /function target\(c: Ctx, rule: 'strict' \| 'notHigher', minimumRole: Role = 'moderator'\)/)
assert.match(mock, /const denied = need\(c, minimumRole\)/)
assert.equal(mock.match(/target\(c, 'strict', 'support'\)/g)?.length, 1, 'only group reset lowers the default target minimum')
assert.match(mock, /const user = target\(c, 'strict', 'support'\)[\s\S]*?groupGenerations\.set\(user\.id, generation\)/)
assert.match(mock, /rule === 'strict' && c\.params\[0\] === c\.me!\.id/)
assert.match(mock, /const higher = !hasRole\(c\.me!\.role, u\.role\)/)
assert.match(mock, /const equal = u\.role === c\.me!\.role/)
assert.match(mock, /rule === 'strict' && \(higher \|\| \(equal && c\.me!\.role !== 'admin'\)\)/)
const dialog = source('./GroupResetDialog.tsx')
const detail = source('../../pages/admin/UserDetail.tsx')
const form = source('../../lib/useForm.ts')
assert.match(endpoint, /api\.post<GroupResetResponse>\(`\/admin\/users\/\$\{id\}\/groups\/reset`, \{ reason \}\)/)
assert.match(dialog, /reason: \(v\) => !v\.trim\(\)/)
assert.match(dialog, /v\.trim\(\)\.length > 2000/)
assert.match(dialog, /v === u\.username/)
assert.match(dialog, /groupResets\.submit\(confirmation, reason, adminApi\.resetGroups\)/)
assert.match(dialog, /role="alertdialog"/)
assert.match(dialog, /<Button data-autofocus variant="soft"/)
assert.match(dialog, /busy=\{busy\}/)
assert.match(dialog, /variant="danger" loading=\{busy\}/)
assert.match(dialog, /failure && <Note tone="danger">/)
assert.match(form, /if \(inFlight\.current\) return/, 'the shared form synchronously prevents duplicate submissions')
// Wiring checks only; deferred navigation/recovery behavior is tested in groupResetController.check.ts.
assert.match(detail, /resetConfirmation\?\.targetId === id && u\.id === id/)
assert.match(detail, /resetCompletedFor\(resetState, current\)/)
assert.match(detail, /res\.reload\(\)/)
assert.match(detail, /\{resetNotice\}/, 'confirmed success remains visible if the follow-up refresh fails')
for (const d of [ru, en]) {
  assert.ok(d.user.groupsResetReason.length > 0)
  assert.ok(d.user.groupsResetUsername.includes('{name}'))
  assert.ok(d.user.groupsResetConfirm.includes('{name}'))
  assert.ok(d.user.groupsResetPending.length > 0)
  assert.ok(d.user.groupsResetUnknown.length > 0)
  assert.ok(d.user.groupsResetVerified.length > 0)
  for (const count of ['{removed}', '{cancelled}', '{generation}']) assert.ok(d.user.groupsResetDone.includes(count))
  assert.ok(d.audit.actions.reset_group_inventory.length > 0)
}
assert.match(en.user.groupsResetWarning, /quotas are not replenished/)
assert.match(en.user.groupsResetWarning, /Old libraries re-register their groups/)
assert.match(ru.user.groupsResetWarning, /не пополняются/)
assert.match(ru.user.groupsResetWarning, /старые библиотеки зарегистрируют свои группы заново/)
console.log('admin access: role behavior and reset wiring/copy checks: ok (not browser lifecycle evidence)')
