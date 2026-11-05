// Coordinator only: node src/features/admin/groupResetController.check.ts
// Pure behavioral tests of the production controller; no DOM/browser claims.
// Uses the real auth activation store; token/client races are in api/client.check.ts.
import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError } from '../../api/errors.ts'
import { createGroupResetController, isDefiniteResetRejection, resetCompletedFor } from './groupResetController.ts'
import { createAuthSessionStore } from '../../context/authSession.ts'

function createController(actorId = 'staff') {
  const sessions = createAuthSessionStore()
  sessions.activate(actorId)
  return Object.assign(createGroupResetController(sessions), { sessions })
}

const result = { generation: 7, removed_groups: 3, cancelled_reservations: 2 }
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('deferred not initialized') }
  let reject: (error: unknown) => void = () => { throw new Error('deferred not initialized') }
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('groupResetController: duplicate submit and unmount cannot release an in-flight target', async () => {
  const controller = createController()
  const request = deferred<typeof result>()
  const confirmation = controller.openConfirmation('staff', 'A', 'alice')
  let calls = 0
  let notifications = 0
  const unsubscribe = controller.subscribe(() => { notifications++ })
  const send = (targetId: string, reason: string) => {
    assert.equal(targetId, 'A')
    assert.equal(reason, 'investigated')
    calls++
    return request.promise
  }
  const pending = controller.submit(confirmation, '  investigated  ', send)
  await controller.submit(confirmation, 'investigated', send)
  assert.equal(calls, 1)
  assert.equal(controller.getSnapshot('A').kind, 'pending')
  unsubscribe() // Modal AND page may now unmount; ownership remains outside them.
  const remounted = controller.openConfirmation('staff', 'A', 'alice')
  await controller.submit(remounted, 'new reason', send)
  assert.equal(calls, 1)
  request.resolve(result)
  await pending
  assert.equal(notifications, 1, 'unmounted subscriber is not retained')
  assert.equal(controller.getSnapshot('A').kind, 'succeeded')
  assert.equal(resetCompletedFor(controller.getSnapshot('A'), remounted), false)
})

test('groupResetController: deferred A→B→A navigation cannot close B or remounted A', async () => {
  const controller = createController()
  const a = deferred<typeof result>()
  const b = deferred<typeof result>()
  const firstA = controller.openConfirmation('staff', 'A', 'alice')
  const aPending = controller.submit(firstA, 'A reason', () => a.promise)
  const currentB = controller.openConfirmation('staff', 'B', 'bob')
  const bPending = controller.submit(currentB, 'B reason', () => b.promise)
  const remountedA = controller.openConfirmation('staff', 'A', 'alice')
  let extraCalls = 0
  await controller.submit(remountedA, 'second A', async () => { extraCalls++; return result })
  assert.equal(extraCalls, 0, 'browser history cannot bypass A pending guard')
  a.resolve(result)
  await aPending
  const aState = controller.getSnapshot('A')
  assert.equal(resetCompletedFor(aState, firstA), true)
  assert.equal(resetCompletedFor(aState, currentB), false)
  assert.equal(resetCompletedFor(aState, remountedA), false)
  assert.equal(controller.getSnapshot('B').kind, 'pending')
  b.resolve(result)
  await bPending
  assert.equal(resetCompletedFor(controller.getSnapshot('B'), currentB), true)
})

test('groupResetController: another actor cannot replay a pending target or inherit completion ownership', async () => {
  const controller = createController('staff-one')
  const response = deferred<typeof result>()
  const oldActor = controller.openConfirmation('staff-one', 'A', 'alice')
  const pending = controller.submit(oldActor, 'reason', () => response.promise)
  controller.sessions.activate('staff-two')
  const newActor = controller.openConfirmation('staff-two', 'A', 'alice')
  let extraCalls = 0
  await controller.submit(newActor, 'reason', async () => { extraCalls++; return result })
  assert.equal(extraCalls, 0)
  response.resolve(result)
  await pending
  assert.equal(resetCompletedFor(controller.getSnapshot('A'), newActor), false)
})

for (const error of [
  new ApiError({ status: 0, message: 'generic try again must not be displayed' }),
  new ApiError({ status: 502, message: 'proxy' }),
  new ApiError({ status: 503, message: 'unavailable' }),
  new ApiError({ status: 500, code: 'validation_failed', message: 'ambiguous despite code' }),
  new ApiError({ status: 408, message: 'timeout' }),
  new TypeError('response body lost'),
]) {
  test(`groupResetController: ${error.name}/${error instanceof ApiError ? error.status : 'body'} requires verification and a NEW confirmation`, async () => {
    const controller = createController()
    const old = controller.openConfirmation('staff', 'A', 'alice')
    const response = deferred<typeof result>()
    const pending = controller.submit(old, 'old confirmed reason', () => response.promise)
    response.reject(error)
    await pending
    const unknown = controller.getSnapshot('A')
    assert.equal(unknown.kind, 'unknown')
    assert.equal(isDefiniteResetRejection(error), false)
    let replays = 0
    const send = async () => { replays++; return result }
    await controller.submit(old, 'old confirmed reason', send)
    const reopened = controller.openConfirmation('staff', 'A', 'alice')
    await controller.submit(reopened, 'new reason without verification', send)
    assert.equal(replays, 0, 'reopening does not acknowledge the uncertain outcome')
    assert.equal(controller.verifyOutcome(old, unknown), null, 'obsolete recovery control cannot unlock')
    const fresh = controller.verifyOutcome(reopened, unknown)
    assert.ok(fresh)
    assert.notEqual(fresh, reopened)
    assert.equal(controller.verifyOutcome(reopened, unknown), null)
    await controller.submit(old, 'old confirmed reason', send)
    await controller.submit(reopened, 'already filled reason', send)
    assert.equal(replays, 0, 'previous typed confirmations remain invalid after verification')
    await controller.submit(fresh, '', send)
    assert.equal(replays, 0, 'new confirmation still needs a new reason')
    await controller.submit(fresh, 'new deliberate action', send)
    assert.equal(replays, 1)
    assert.equal(controller.getSnapshot('A').kind, 'succeeded')
  })
}

for (const error of [
  new ApiError({ status: 422, code: 'validation_failed', message: 'localized reason error', fields: { reason: 'required' } }),
  new ApiError({ status: 403, code: 'insufficient_role', message: 'localized permission error' }),
  new ApiError({ status: 403, code: 'target_role_too_high', message: 'localized target error' }),
]) {
  test(`groupResetController: definite ${error.code} refusal stays separately recoverable`, async () => {
    const controller = createController()
    const confirmation = controller.openConfirmation('staff', 'A', 'alice')
    await controller.submit(confirmation, 'reason', async () => { throw error })
    const rejected = controller.getSnapshot('A')
    assert.equal(rejected.kind, 'rejected')
    if (rejected.kind !== 'rejected') throw new Error('expected rejection')
    assert.equal(rejected.error, error)
    assert.equal(isDefiniteResetRejection(error), true)
    await controller.submit(confirmation, 'corrected reason', async () => result)
    assert.equal(controller.getSnapshot('A').kind, 'succeeded')
  })
}

test('groupResetController: a successful confirmation is consumed before the modal-close effect', async () => {
  const controller = createController()
  const confirmation = controller.openConfirmation('staff', 'A', 'alice')
  let calls = 0
  const send = async () => { calls++; return result }
  await controller.submit(confirmation, 'confirmed reason', send)
  const success = controller.getSnapshot('A')
  await controller.submit(confirmation, 'already filled reason', send)
  assert.equal(calls, 1)
  assert.equal(controller.getSnapshot('A'), success)
  const fresh = controller.openConfirmation('staff', 'A', 'alice')
  await controller.submit(fresh, 'new deliberate action', send)
  assert.equal(calls, 2)
})

test('groupResetController: malformed successful response is also outcome-unknown', async () => {
  const controller = createController()
  const confirmation = controller.openConfirmation('staff', 'A', 'alice')
  await controller.submit(confirmation, 'reason', async () => null)
  assert.equal(controller.getSnapshot('A').kind, 'unknown')
})

for (const replacements of [['staff'], ['other'], ['other', 'staff']]) {
  test(`groupResetController: real activation replacement ${replacements.join('→')} retires old deferred completion, not its barrier`, async () => {
    const controller = createController()
    const original = controller.openConfirmation('staff', 'A', 'alice')
    const response = deferred<typeof result>()
    const pending = controller.submit(original, 'investigated', () => response.promise)
    controller.sessions.clear()
    for (const actor of replacements) controller.sessions.activate(actor)
    const actor = replacements[replacements.length - 1]
    const fresh = controller.openConfirmation(actor, 'A', 'alice')
    let duplicates = 0
    const send = async () => { duplicates++; return result }
    await controller.submit(original, 'old confirmation', send)
    await controller.submit(fresh, 'new confirmation', send)
    assert.equal(duplicates, 0, 'auth replacement cannot bypass a pending POST')
    response.resolve(result)
    await pending
    const unknown = controller.getSnapshot('A')
    assert.equal(unknown.kind, 'unknown', 'old success must not be inherited by a replacement activation')
    assert.equal(resetCompletedFor(unknown, original), false)
    assert.equal(resetCompletedFor(unknown, fresh), false)
    assert.equal(controller.verifyOutcome(original, unknown), null, 'retired recovery control cannot unlock')
    await controller.submit(fresh, 'not yet verified', send)
    assert.equal(duplicates, 0, 'unknown barrier survives logout/relogin')
    const verified = controller.verifyOutcome(fresh, unknown)
    assert.ok(verified)
    await controller.submit(fresh, 'filled old form', send)
    assert.equal(duplicates, 0)
    await controller.submit(verified, 'new deliberate action after investigation', send)
    assert.equal(duplicates, 1)
  })
}

test('groupResetController: same-account reactivation invalidates an unsubmitted confirmation', async () => {
  const controller = createController()
  const old = controller.openConfirmation('staff', 'A', 'alice')
  controller.sessions.activate('staff')
  let calls = 0
  await controller.submit(old, 'old typed reason', async () => { calls++; return result })
  assert.equal(calls, 0)
  assert.equal(controller.getSnapshot('A').kind, 'ready')
})

