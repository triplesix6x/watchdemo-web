// Coordinator only: node src/api/client.check.ts
// Real client/auth actions/reset controller, with deferred HTTP responses only.
// No network, React/browser mount, or cross-tab cookie-synchronization claim.
import assert from 'node:assert/strict'
import test from 'node:test'
import * as client from './client.ts'
import type { LoginResponse, User } from './types.ts'
import { createAuthActions } from '../context/authLifecycle.ts'
import { createAuthSessionStore } from '../context/authSession.ts'
import { createGroupResetController, resetCompletedFor } from '../features/admin/groupResetController.ts'

Object.defineProperty(globalThis, '__MOCK__', { configurable: true, value: false })

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('uninitialized deferred') }
  let reject: (error: unknown) => void = () => { throw new Error('uninitialized deferred') }
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function transport() {
  const original = globalThis.fetch
  type Request = { path: string; method: string; bearer: string | null; response: ReturnType<typeof deferred<Response>> }
  const requests: Request[] = []
  const waiting: Array<(request: Request) => void> = []
  const unread: Request[] = []
  let cookie: string | null = 'old-cookie'
  globalThis.fetch = (input, init) => {
    const request: Request = {
      path: String(input), method: init?.method ?? 'GET',
      bearer: new Headers(init?.headers).get('Authorization'), response: deferred<Response>(),
    }
    requests.push(request)
    const reader = waiting.shift()
    if (reader) reader(request)
    else unread.push(request)
    return request.response.promise
  }
  return {
    requests,
    next: async () => unread.shift() ?? new Promise<Request>((resolve) => waiting.push(resolve)),
    respond: (request: Request, status: number, body: unknown = null, nextCookie?: string | null) => {
      // Simulate browser cookie application before JavaScript receives the response.
      if (nextCookie !== undefined) cookie = nextCookie
      request.response.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }))
    },
    cookie: () => cookie,
    restore: () => { globalThis.fetch = original },
  }
}

const user = (id: string, username = id): User => ({
  id, username, email: `${id}@example.invalid`, role: 'support', is_verified: true,
  subscription: null, created_at: null, is_beta_tester: false, locale: 'en',
})
function accessToken(label: string, subject = label, sessionId = `session-${subject}`): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    type: 'access', sub: subject, sid: sessionId, jti: label, exp: 4_000_000_000,
  })}.${encode('test-signature')}`
}
const loginToken = (id: string, username = id) => accessToken(`token-${username}`, id, `session-${username}`)
const loginResponse = (id: string, username = id): LoginResponse => ({
  access_token: loginToken(id, username), refresh_token: `cookie-${username}`, user: user(id, username),
})

function authFixture() {
  const sessions = createAuthSessionStore()
  let presented: User | null = null
  let scheduled: string | null = null
  const actions = createAuthActions({
    sessions, credentials: client,
    loginRequest: (login, password) => client.api.post<LoginResponse>('/auth/login', { login, password }),
    logoutRequest: client.logoutSession,
    getUser: () => client.api.get<User>('/users/me'),
    onUser: (next) => { presented = next }, onToken: (next) => { scheduled = next },
  })
  client.initClient(actions.unauthenticated)
  return { sessions, actions, presented: () => presented, scheduled: () => scheduled }
}

async function assertToken(http: ReturnType<typeof transport>, token: string | null) {
  const probe = client.api.get('/probe')
  const request = await http.next()
  assert.equal(request.bearer, token === null ? null : `Bearer ${token}`)
  http.respond(request, 200, {})
  await probe
}

for (const retryStatus of [200, 401]) {
  test(`client: late original 401 retries the completed same-session rotation once (${retryStatus})`, async (t) => {
    const http = transport()
    t.after(http.restore)
    const auth = authFixture()
    const login = auth.actions.login('A', 'fixture')
    http.respond(await http.next(), 200, loginResponse('A'), 'cookie-A')
    await login
    const activation = auth.sessions.getSnapshot()
    let unauthorized = 0
    client.initClient((revision) => { unauthorized++; auth.actions.unauthenticated(revision) })
    const first = client.api.get('/first')
    const firstRequest = await http.next()
    const second = client.api.get('/second')
    const secondRequest = await http.next()
    assert.equal(firstRequest.bearer, `Bearer ${loginToken('A')}`)
    assert.equal(secondRequest.bearer, firstRequest.bearer)
    http.respond(firstRequest, 401, { code: 'token_expired' })
    const refresh = await http.next()
    assert.equal(refresh.path, '/api/v1/auth/refresh')
    const rotated = accessToken('rotated-A', 'A')
    http.respond(refresh, 200, { access_token: rotated }, 'rotated-cookie-A')
    const firstRetry = await http.next()
    assert.equal(firstRetry.path, '/api/v1/first')
    assert.equal(firstRetry.bearer, `Bearer ${rotated}`)
    http.respond(firstRetry, 200, { request: 'first' })
    assert.deepEqual(await first, { request: 'first' })
    assert.equal(auth.sessions.getSnapshot(), activation)
    const rotationRevision = client.getCredentialRevision()

    // Deliver B's original response only after A's refresh AND retry completed.
    const secondResult = retryStatus === 401 ? assert.rejects(second, { status: 401 }) : second
    http.respond(secondRequest, 401, { code: 'token_expired' })
    const secondRetry = await http.next()
    assert.equal(secondRetry.path, '/api/v1/second')
    assert.equal(secondRetry.bearer, `Bearer ${rotated}`)
    http.respond(secondRetry, retryStatus, retryStatus === 200 ? { request: 'second' } : { code: 'session_revoked' })
    if (retryStatus === 200) assert.deepEqual(await secondResult, { request: 'second' })
    else await secondResult
    assert.equal(http.requests.filter((request) => request.path === '/api/v1/auth/refresh').length, 1)
    assert.equal(http.requests.filter((request) => request.path === '/api/v1/second').length, 2, 'a second-attempt 401 never triggers another retry')
    assert.equal(unauthorized, retryStatus === 401 ? 1 : 0)
    assert.equal(auth.sessions.getSnapshot(), retryStatus === 401 ? null : activation)
    assert.equal(http.cookie(), 'rotated-cookie-A')
    if (retryStatus === 200) {
      assert.equal(client.getCredentialRevision(), rotationRevision)
      await assertToken(http, rotated)
    } else {
      await assertToken(http, null)
    }
  })
}

test('client: late original 401 uses the current bearer across successive verified rotations', async (t) => {
  const http = transport()
  t.after(http.restore)
  client.initClient(() => { throw new Error('unexpected unauthorized callback') })
  client.setAccessToken(accessToken('old-A', 'A'))
  const pending = client.api.get('/protected')
  const original = await http.next()
  for (const label of ['first-rotation', 'current-rotation']) {
    const rotation = client.refreshTokens()
    http.respond(await http.next(), 200, { access_token: accessToken(label, 'A') })
    assert.equal((await rotation).kind, 'refreshed')
  }
  http.respond(original, 401, { code: 'token_expired' })
  const retry = await http.next()
  assert.equal(retry.path, '/api/v1/protected')
  assert.equal(retry.bearer, `Bearer ${accessToken('current-rotation', 'A')}`)
  http.respond(retry, 200, { current: true })
  assert.deepEqual(await pending, { current: true })
  assert.equal(http.requests.length, 4, 'two explicit rotations and one bounded retry, no extra refresh')
})

for (const replacements of [[], ['A'], ['B'], ['B', 'A']]) {
  test(`client: late original 401 after rotation cannot retry across ${replacements.length ? replacements.join('→') : 'logout'}`, async (t) => {
    const http = transport()
    t.after(http.restore)
    const auth = authFixture()
    const login = auth.actions.login('A', 'fixture')
    http.respond(await http.next(), 200, loginResponse('A'), 'cookie-A')
    await login
    const oldActivation = auth.sessions.getSnapshot()
    const pending = client.api.get('/protected')
    const original = await http.next()
    const rotation = client.refreshTokens()
    http.respond(await http.next(), 200, { access_token: accessToken('rotated-A', 'A') }, 'rotated-cookie-A')
    assert.equal((await rotation).kind, 'refreshed')
    if (replacements.length === 0) {
      const logout = auth.actions.logout()
      const request = await http.next()
      assert.equal(request.path, '/api/v1/auth/logout')
      http.respond(request, 204, null, null)
      await logout
    }
    for (const id of replacements) {
      const replacement = auth.actions.login(id, 'fixture')
      const request = await http.next()
      // Relogging A deliberately reuses the original sub, sid AND bearer.
      http.respond(request, 200, loginResponse(id), `cookie-${id}`)
      await replacement
    }
    const activation = auth.sessions.getSnapshot()
    const revision = client.getCredentialRevision()
    const cookie = http.cookie()
    assert.notEqual(activation, oldActivation)
    let unauthorized = 0
    client.initClient((current) => { unauthorized++; auth.actions.unauthenticated(current) })
    const requestCount = http.requests.length
    http.respond(original, 401, { code: 'token_expired' })
    await assert.rejects(pending, { status: 401 })
    assert.equal(http.requests.length, requestCount, 'never acquire or attach replacement credentials')
    assert.equal(unauthorized, 0)
    assert.equal(client.getCredentialRevision(), revision)
    assert.equal(auth.sessions.getSnapshot(), activation)
    assert.equal(http.cookie(), cookie)
    await assertToken(http, replacements.length ? loginToken(replacements[replacements.length - 1]) : null)
  })
}

for (const binding of [
  { name: 'cross-tab subject mismatch', subject: 'B', sessionId: 'session-A' },
  { name: 'cross-tab sid mismatch', subject: 'A', sessionId: 'replacement-session-A' },
]) {
  test(`client: late original 401 cannot retry after ${binding.name} retires rotation ownership`, async (t) => {
    const http = transport()
    t.after(http.restore)
    const auth = authFixture()
    client.setAccessToken(accessToken('old-A', 'A'))
    auth.sessions.activate('A')
    const pending = client.api.get('/protected')
    const original = await http.next()
    const rotation = client.refreshTokens()
    http.respond(await http.next(), 200, {
      access_token: accessToken('replacement', binding.subject, binding.sessionId),
    }, 'replacement-cookie')
    assert.equal((await rotation).kind, 'rejected')
    assert.equal(auth.sessions.getSnapshot(), null)
    const revision = client.getCredentialRevision()
    const requestCount = http.requests.length
    http.respond(original, 401, { code: 'token_expired' })
    await assert.rejects(pending, { status: 401 })
    assert.equal(http.requests.length, requestCount)
    assert.equal(client.getCredentialRevision(), revision)
    assert.equal(http.cookie(), 'replacement-cookie')
    await assertToken(http, null)
  })
}

test('client: deferred stale 401 cannot refresh, retry, or notify a replacement credential', async (t) => {
  const http = transport()
  t.after(http.restore)
  let unauthorized = 0
  client.initClient(() => { unauthorized++ })
  client.setAccessToken(accessToken('old'))
  const pending = client.api.get('/protected')
  const request = await http.next()
  client.setAccessToken(accessToken('replacement'))
  const revision = client.getCredentialRevision()
  http.respond(request, 401, { code: 'token_expired' })
  await assert.rejects(pending)
  assert.equal(http.requests.length, 1)
  assert.equal(unauthorized, 0)
  assert.equal(client.getCredentialRevision(), revision)
  await assertToken(http, accessToken('replacement'))
})

for (const outcome of ['success', 'refusal', 'network'] as const) {
  test(`client: deferred stale refresh ${outcome} cannot write/clear replacement credentials`, async (t) => {
    const http = transport()
    t.after(http.restore)
    client.setAccessToken(accessToken('old'))
    const pending = client.refreshTokens()
    const request = await http.next()
    client.setAccessToken(accessToken('replacement'))
    const revision = client.getCredentialRevision()
    if (outcome === 'network') request.response.reject(new TypeError('fixture transport failed'))
    else http.respond(request, outcome === 'success' ? 200 : 401, { access_token: accessToken('stale-token', 'old') })
    assert.equal((await pending).kind, 'stale')
    assert.equal(client.getCredentialRevision(), revision)
    await assertToken(http, accessToken('replacement'))
  })
}

test('client: a stale shared-refresh rejection cannot notify unauthorized after replacement', async (t) => {
  const http = transport()
  t.after(http.restore)
  let unauthorized = 0
  client.initClient(() => { unauthorized++ })
  client.setAccessToken(accessToken('old'))
  const pending = client.api.get('/protected')
  const request = await http.next()
  http.respond(request, 401, { code: 'token_expired' })
  const refresh = await http.next()
  assert.equal(refresh.path, '/api/v1/auth/refresh')
  client.setAccessToken(accessToken('replacement'))
  const revision = client.getCredentialRevision()
  http.respond(refresh, 401, { code: 'session_revoked' })
  await assert.rejects(pending)
  assert.equal(unauthorized, 0)
  assert.equal(client.getCredentialRevision(), revision)
  assert.equal(http.requests.length, 2, 'never retry the original request as a replacement account')
})

test('client: deferred retry 401 cannot notify unauthorized for replacement credentials', async (t) => {
  const http = transport()
  t.after(http.restore)
  let unauthorized = 0
  client.initClient(() => { unauthorized++ })
  client.setAccessToken(accessToken('old'))
  const pending = client.api.get('/protected')
  const request = await http.next()
  http.respond(request, 401, { code: 'token_expired' })
  const refresh = await http.next()
  http.respond(refresh, 200, { access_token: accessToken('rotated', 'old') })
  const retry = await http.next()
  assert.equal(retry.bearer, `Bearer ${accessToken('rotated', 'old')}`)
  client.setAccessToken(accessToken('replacement'))
  const revision = client.getCredentialRevision()
  http.respond(retry, 401, { code: 'session_revoked' })
  await assert.rejects(pending)
  assert.equal(unauthorized, 0)
  assert.equal(client.getCredentialRevision(), revision)
  assert.equal(http.requests.length, 3)
})

test('client: refresh coalescing and cleanup belong to their captured revision', async (t) => {
  const http = transport()
  t.after(http.restore)
  client.setAccessToken(accessToken('old'))
  const old = client.refreshTokens()
  const oldRequest = await http.next()
  client.setAccessToken(accessToken('replacement'))
  const current = client.refreshTokens()
  assert.equal(client.refreshTokens(), current)
  http.respond(oldRequest, 401, { code: 'session_revoked' })
  assert.equal((await old).kind, 'stale')
  const currentRequest = await http.next()
  assert.equal(client.refreshTokens(), current, 'old finally must not discard the replacement flight')
  http.respond(currentRequest, 200, { access_token: accessToken('rotated-replacement', 'replacement') })
  assert.equal((await current).kind, 'refreshed')
  await assertToken(http, accessToken('rotated-replacement', 'replacement'))
})

test('authLifecycle/client: old logout cookie settles before newer login starts and never clears its result', async (t) => {
  const http = transport()
  t.after(http.restore)
  const auth = authFixture()
  client.setAccessToken(accessToken('old'))
  auth.sessions.activate('old')
  const logout = auth.actions.logout()
  assert.equal(auth.sessions.getSnapshot(), null, 'retire semantic activation before the await')
  const oldRequest = await http.next()
  assert.equal(oldRequest.path, '/api/v1/auth/logout')
  assert.equal(oldRequest.bearer, `Bearer ${accessToken('old')}`)
  const login = auth.actions.login('new', 'fixture')
  assert.equal(http.requests.length, 1, 'login must wait for browser-applied logout cookie')
  http.respond(oldRequest, 204, null, null)
  const newRequest = await http.next()
  assert.equal(http.cookie(), null)
  assert.equal(newRequest.path, '/api/v1/auth/login')
  http.respond(newRequest, 200, loginResponse('new'), 'cookie-new')
  await Promise.all([logout, login])
  assert.equal(http.cookie(), 'cookie-new')
  assert.equal(auth.presented()?.id, 'new')
  assert.equal(auth.sessions.getSnapshot()?.actorId, 'new')
  await assertToken(http, loginToken('new'))
})

test('client: logout 401 never refreshes or retries with a newer login', async (t) => {
  const http = transport()
  t.after(http.restore)
  const auth = authFixture()
  client.setAccessToken(accessToken('old'))
  auth.sessions.activate('old')
  const logout = auth.actions.logout()
  const oldRequest = await http.next()
  const login = auth.actions.login('new', 'fixture')
  http.respond(oldRequest, 401, { code: 'token_expired' })
  const newRequest = await http.next()
  assert.equal(newRequest.path, '/api/v1/auth/login')
  http.respond(newRequest, 200, loginResponse('new'), 'cookie-new')
  await Promise.all([logout, login])
  assert.equal(http.requests.length, 2)
  assert.equal(auth.presented()?.id, 'new')
})

test('client: queued old logout is skipped, not sent after replacement login', async (t) => {
  const http = transport()
  t.after(http.restore)
  const auth = authFixture()
  client.setAccessToken(accessToken('old'))
  auth.sessions.activate('old')
  const refresh = client.refreshTokens()
  const refreshRequest = await http.next()
  const logout = auth.actions.logout()
  const login = auth.actions.login('new', 'fixture')
  http.respond(refreshRequest, 200, { access_token: accessToken('stale', 'old') }, 'stale-cookie')
  assert.equal((await refresh).kind, 'stale')
  const newRequest = await http.next()
  assert.equal(newRequest.path, '/api/v1/auth/login')
  http.respond(newRequest, 200, loginResponse('new'), 'cookie-new')
  await Promise.all([logout, login])
  assert.equal(http.requests.length, 2)
  assert.equal(http.cookie(), 'cookie-new')
})

test('client: failed cookie queue entry does not wedge the next login', async (t) => {
  const http = transport()
  t.after(http.restore)
  const auth = authFixture()
  const oldLogin = auth.actions.login('old', 'fixture')
  const oldRejected = assert.rejects(oldLogin)
  const oldRequest = await http.next()
  const newLogin = auth.actions.login('new', 'fixture')
  oldRequest.response.reject(new TypeError('fixture connection lost'))
  const newRequest = await http.next()
  http.respond(newRequest, 200, loginResponse('new'), 'cookie-new')
  await Promise.all([oldRejected, newLogin])
  assert.equal(auth.presented()?.id, 'new')
})

test('client: account-deletion cookie settles before replacement login', async (t) => {
  const http = transport()
  t.after(http.restore)
  const auth = authFixture()
  client.setAccessToken(accessToken('old'))
  auth.sessions.activate('old')
  const deletion = client.api.delete('/users/me', { password: 'fixture', username: 'old' })
  const oldRequest = await http.next()
  const login = auth.actions.login('new', 'fixture')
  assert.equal(http.requests.length, 1)
  http.respond(oldRequest, 204, null, null)
  const newRequest = await http.next()
  assert.equal(newRequest.path, '/api/v1/auth/login')
  http.respond(newRequest, 200, loginResponse('new'), 'cookie-new')
  await Promise.all([deletion, login])
  assert.equal(http.cookie(), 'cookie-new')
  assert.equal(auth.presented()?.id, 'new')
})

test('client: deletion releases cookie queue before revision-bound refresh and retry', async (t) => {
  const http = transport()
  t.after(http.restore)
  client.initClient(() => { throw new Error('unexpected unauthorized callback') })
  client.setAccessToken(accessToken('old'))
  const deletion = client.api.delete('/users/me', { password: 'fixture', username: 'old' })
  const original = await http.next()
  http.respond(original, 401, { code: 'token_expired' })
  const refresh = await http.next()
  assert.equal(refresh.path, '/api/v1/auth/refresh')
  http.respond(refresh, 200, { access_token: accessToken('rotated', 'old') }, 'rotated-cookie')
  const retry = await http.next()
  assert.equal(retry.path, '/api/v1/users/me')
  assert.equal(retry.bearer, `Bearer ${accessToken('rotated', 'old')}`)
  http.respond(retry, 204, null, null)
  await deletion
  assert.equal(http.requests.length, 3)
})

test('authLifecycle: deferred old login cannot publish over a replacement login', async (t) => {
  const http = transport()
  t.after(http.restore)
  const auth = authFixture()
  const oldLogin = auth.actions.login('old', 'fixture')
  const oldRequest = await http.next()
  const newLogin = auth.actions.login('new', 'fixture')
  http.respond(oldRequest, 200, loginResponse('old'), 'cookie-old')
  await oldLogin
  assert.equal(auth.presented(), null)
  const newRequest = await http.next()
  http.respond(newRequest, 200, loginResponse('new'), 'cookie-new')
  await newLogin
  assert.equal(auth.presented()?.id, 'new')
  await assertToken(http, loginToken('new'))
})

for (const intermediate of [false, true]) {
  test(`authLifecycle: deferred login is retired by ${intermediate ? 'A→B→A' : 'same-account reactivation'}`, async (t) => {
    const http = transport()
    t.after(http.restore)
    const auth = authFixture()
    const old = auth.actions.login('A', 'fixture')
    const oldRequest = await http.next()
    const skipped = intermediate ? assert.rejects(auth.actions.login('B', 'fixture')) : Promise.resolve()
    const current = auth.actions.login('A', 'fixture')
    http.respond(oldRequest, 200, loginResponse('A', 'stale-A'), 'cookie-stale-A')
    await old
    assert.equal(auth.presented(), null)
    const currentRequest = await http.next()
    http.respond(currentRequest, 200, loginResponse('A', 'new-A'), 'cookie-new-A')
    await Promise.all([skipped, current])
    assert.equal(auth.presented()?.username, 'new-A')
    assert.equal(http.requests.length, 2, 'retired queued B login is never sent')
    assert.equal(http.cookie(), 'cookie-new-A')
    await assertToken(http, loginToken('A', 'new-A'))
  })
}

for (const replacements of [['A'], ['B'], ['B', 'A']]) {
  test(`authLifecycle: deferred /me cannot overwrite real reactivation ${replacements.join('→')}`, async (t) => {
    const http = transport()
    t.after(http.restore)
    const auth = authFixture()
    client.setAccessToken(accessToken('old-A', 'A'))
    auth.sessions.activate('A')
    const refreshUser = auth.actions.refreshUser()
    const oldMe = await http.next()
    const oldActivation = auth.sessions.getSnapshot()
    for (const id of replacements) {
      const login = auth.actions.login(id, 'fixture')
      const request = await http.next()
      http.respond(request, 200, loginResponse(id, `new-${id}`), `cookie-new-${id}`)
      await login
    }
    const current = auth.sessions.getSnapshot()
    assert.notEqual(current, oldActivation)
    http.respond(oldMe, 200, user('A', 'stale-profile'))
    await refreshUser
    assert.equal(auth.sessions.getSnapshot(), current)
    assert.equal(auth.presented()?.username, `new-${replacements[replacements.length - 1]}`)
    auth.actions.setUser(user('A', 'stale-patch'), oldActivation)
    assert.notEqual(auth.presented()?.username, 'stale-patch')
  })
}

test('authLifecycle: startup /me cannot install over same-account relogin', async (t) => {
  const http = transport()
  t.after(http.restore)
  const auth = authFixture()
  client.clearTokens()
  const restoration = auth.actions.restore()
  assert.equal(auth.actions.restore(), restoration, 'StrictMode replay shares one restore')
  const refresh = await http.next()
  http.respond(refresh, 200, { access_token: accessToken('restored-A', 'A') })
  const oldMe = await http.next()
  const login = auth.actions.login('A', 'fixture')
  const request = await http.next()
  http.respond(request, 200, loginResponse('A', 'new-A'), 'cookie-new-A')
  await login
  const current = auth.sessions.getSnapshot()
  http.respond(oldMe, 200, user('A', 'stale-restoration'))
  await restoration
  assert.equal(auth.presented()?.username, 'new-A')
  assert.equal(auth.sessions.getSnapshot(), current)
  assert.equal(auth.scheduled(), loginToken('A', 'new-A'))
})

test('authLifecycle: stale restoration /me failure cannot clear a newer credential rotation', async (t) => {
  const http = transport()
  t.after(http.restore)
  const auth = authFixture()
  client.clearTokens()
  const restoration = auth.actions.restore()
  const refresh = await http.next()
  http.respond(refresh, 200, { access_token: accessToken('restored', 'A') })
  const oldMe = await http.next()
  const rotation = client.refreshTokens()
  const rotationRequest = await http.next()
  http.respond(rotationRequest, 200, { access_token: accessToken('newer-rotation', 'A') })
  assert.equal((await rotation).kind, 'refreshed')
  const revision = client.getCredentialRevision()
  oldMe.response.reject(new TypeError('fixture profile transport failed'))
  await restoration
  assert.equal(client.getCredentialRevision(), revision)
  await assertToken(http, accessToken('newer-rotation', 'A'))
})

test('authLifecycle/client/reset: normal token rotation preserves pending reset and /me ownership', async (t) => {
  const http = transport()
  t.after(http.restore)
  const auth = authFixture()
  const login = auth.actions.login('staff', 'fixture')
  const loginRequest = await http.next()
  http.respond(loginRequest, 200, loginResponse('staff'), 'cookie-staff')
  await login
  const activation = auth.sessions.getSnapshot()
  const controller = createGroupResetController(auth.sessions)
  const confirmation = controller.openConfirmation('staff', 'target', 'alice')
  const reset = controller.submit(confirmation, 'investigated', (id, reason) => client.api.post(`/admin/users/${id}/groups/reset`, { reason }))
  const resetRequest = await http.next()
  const profile = auth.actions.refreshUser()
  const profileRequest = await http.next()
  const rotation = client.refreshTokens()
  const rotationRequest = await http.next()
  http.respond(rotationRequest, 200, { access_token: accessToken('rotated-staff', 'staff') }, 'rotated-cookie')
  assert.equal((await rotation).kind, 'refreshed')
  assert.equal(auth.sessions.getSnapshot(), activation)
  let duplicateCalls = 0
  await controller.submit(confirmation, 'duplicate', async () => { duplicateCalls++; return null })
  assert.equal(duplicateCalls, 0)
  http.respond(resetRequest, 200, { generation: 4, removed_groups: 2, cancelled_reservations: 1 })
  http.respond(profileRequest, 200, user('staff', 'updated-profile'))
  await Promise.all([reset, profile])
  assert.equal(resetCompletedFor(controller.getSnapshot('target'), confirmation), true)
  assert.equal(auth.sessions.getSnapshot(), activation)
  assert.equal(auth.presented()?.username, 'updated-profile')
  await assertToken(http, accessToken('rotated-staff', 'staff'))
})

for (const binding of [
  { name: 'different subject with the same sid', subject: 'B', sessionId: 'session-A' },
  { name: 'same subject with a different sid', subject: 'A', sessionId: 'replacement-session-A' },
]) {
  for (const trigger of ['scheduled', '401'] as const) {
    test(`authLifecycle/client/reset: ${trigger} refresh rejects ${binding.name} without adopting its credentials`, async (t) => {
      const http = transport()
      t.after(http.restore)
      const auth = authFixture()
      const login = auth.actions.login('A', 'fixture')
      http.respond(await http.next(), 200, loginResponse('A'), 'cookie-A')
      await login
      const controller = createGroupResetController(auth.sessions)
      const confirmation = controller.openConfirmation('A', 'target', 'alice')
      const unsubmitted = controller.openConfirmation('A', 'other-target', 'bob')
      const reset = controller.submit(confirmation, 'investigated', (id, reason) => client.api.post(`/admin/users/${id}/groups/reset`, { reason }))
      const resetRequest = await http.next()
      let pending: Promise<unknown>
      if (trigger === '401') {
        pending = client.api.get('/protected')
        const protectedRequest = await http.next()
        http.respond(protectedRequest, 401, { code: 'token_expired' })
      } else {
        pending = client.refreshTokens()
      }
      const rejected = trigger === '401' ? assert.rejects(pending) : pending
      const refresh = await http.next()
      assert.equal(refresh.path, '/api/v1/auth/refresh')
      const replacement = accessToken('replacement', binding.subject, binding.sessionId)
      http.respond(refresh, 200, { access_token: replacement }, 'cookie-replacement')
      const outcome = await rejected
      if (trigger === 'scheduled') assert.equal(outcome && typeof outcome === 'object' && 'kind' in outcome && outcome.kind, 'rejected')
      assert.equal(auth.presented(), null)
      assert.equal(auth.scheduled(), null)
      assert.equal(auth.sessions.getSnapshot(), null)
      assert.equal(http.cookie(), 'cookie-replacement', 'local retirement must not clear the other session cookie')
      await assertToken(http, null)
      assert.equal(controller.getSnapshot('target').kind, 'pending')
      let replayCalls = 0
      const send = async () => { replayCalls++; return null }
      await controller.submit(unsubmitted, 'stale confirmation', send)
      await controller.submit(confirmation, 'duplicate', send)
      assert.equal(replayCalls, 0)
      http.respond(resetRequest, 200, { generation: 4, removed_groups: 2, cancelled_reservations: 1 })
      await reset
      assert.equal(controller.getSnapshot('target').kind, 'unknown', 'old completion cannot release its barrier')
      const replacementLogin = auth.actions.login(binding.subject, 'fixture')
      http.respond(await http.next(), 200, loginResponse(binding.subject, 'replacement'), 'cookie-replacement')
      await replacementLogin
      const fresh = controller.openConfirmation(binding.subject, 'target', 'alice')
      await controller.submit(fresh, 'do not replay uncertain reset', send)
      assert.equal(replayCalls, 0)
      assert.equal(controller.getSnapshot('target').kind, 'unknown')
      assert.equal(http.requests.some((request) => request.path === '/api/v1/auth/logout'), false)
      assert.equal(http.requests.some((request) => request.bearer === `Bearer ${replacement}`), false)
      assert.equal(http.requests.filter((request) => request.path === '/api/v1/protected').length, trigger === '401' ? 1 : 0)
    })
  }
}

test('authLifecycle/client: initial restoration without an old identity accepts the current cookie and loads its profile', async (t) => {
  const http = transport()
  t.after(http.restore)
  client.clearTokens()
  const auth = authFixture()
  const restoration = auth.actions.restore()
  const refresh = await http.next()
  http.respond(refresh, 200, { access_token: accessToken('restored-B', 'B') }, 'cookie-B')
  const profile = await http.next()
  assert.equal(profile.bearer, `Bearer ${accessToken('restored-B', 'B')}`)
  http.respond(profile, 200, user('B'))
  await restoration
  assert.equal(auth.presented()?.id, 'B')
  assert.equal(auth.sessions.getSnapshot()?.actorId, 'B')
  assert.equal(http.cookie(), 'cookie-B')
})

test('authLifecycle/client: queued logout keeps its captured bearer after an in-flight same-session refresh settles', async (t) => {
  const http = transport()
  t.after(http.restore)
  const auth = authFixture()
  const captured = accessToken('old-A', 'A')
  client.setAccessToken(captured)
  auth.sessions.activate('A')
  const rotation = client.refreshTokens()
  const refresh = await http.next()
  const logout = auth.actions.logout()
  assert.equal(auth.sessions.getSnapshot(), null)
  assert.equal(http.requests.length, 1)
  http.respond(refresh, 200, { access_token: accessToken('rotated-A', 'A') }, 'rotated-cookie-A')
  assert.equal((await rotation).kind, 'stale')
  const request = await http.next()
  assert.equal(request.path, '/api/v1/auth/logout')
  assert.equal(request.bearer, `Bearer ${captured}`)
  http.respond(request, 204, null, null)
  await logout
  assert.equal(http.requests.length, 2, 'no refresh/retry to acquire a different logout credential')
  assert.equal(auth.presented(), null)
  await assertToken(http, null)
})

for (const [name, malformed] of [
  ['invalid JWT', 'not-a-jwt'],
  ['empty sub', accessToken('missing-sub', '')],
  ['empty sid', accessToken('missing-sid', 'A', '')],
]) {
  test(`client: malformed refreshed binding is rejected before install (${name})`, async (t) => {
    const http = transport()
    t.after(http.restore)
    client.setAccessToken(accessToken('A'))
    let unauthorized = 0
    client.initClient((revision) => {
      assert.equal(client.isCredentialCurrent(revision), true)
      unauthorized++
    })
    const rotation = client.refreshTokens()
    http.respond(await http.next(), 200, { access_token: malformed }, 'untouched-cookie')
    assert.equal((await rotation).kind, 'rejected')
    assert.equal(unauthorized, 1)
    await assertToken(http, null)
    assert.equal(http.cookie(), 'untouched-cookie')
  })
}
