// HTTP client for /api/v1.
// Access token: memory only, never written to any storage.
// Refresh token: httpOnly cookie set by the server, JS cannot read it.
// Every failure becomes an ApiError whose message is human text in the UI language.
// With VITE_MOCK_API=1 the transport is swapped for in-memory fixtures (api/mock); the
// __MOCK__ constant is false in normal builds, so the mock code is dropped from the bundle.
import { ApiError, networkError, toApiError } from './errors.ts'
import { ru, type Dict } from '../i18n/ru.ts'
import { en } from '../i18n/en.ts'

export const BASE = '/api/v1'

export type RawResponse = { status: number; data: unknown; retryAfter?: string | null }
export type RawRequest = {
  method: string
  path: string
  body?: unknown
  form?: FormData
  token: string | null
  onProgress?: (percent: number) => void
  /** A 2xx answer is read as a Blob instead of JSON. */
  blob?: boolean
}

export type CredentialRevision = symbol
export type RefreshOutcome =
  | { kind: 'refreshed'; accessToken: string; revision: CredentialRevision }
  | { kind: 'rejected'; revision: CredentialRevision }
  | { kind: 'stale' }

let _accessToken: string | null = null
let _revision: CredentialRevision = Symbol('credentials')
// Only a verified same-sub/sid refresh preserves ownership. Explicit installs and
// clears retire it, even if a later login returns the exact same bearer.
let _ownership = Symbol('credential ownership')
let _onUnauthenticated: ((revision: CredentialRevision) => void) | null = null
let _refreshing: { revision: CredentialRevision; promise: Promise<RefreshOutcome> } | null = null
let _cookieRequests: Promise<unknown> = Promise.resolve()
let _dict: Dict = ru

export function setApiLocale(locale: 'ru' | 'en') {
  _dict = locale === 'en' ? en : ru
}

export function initClient(onUnauthenticated: (revision: CredentialRevision) => void) {
  _onUnauthenticated = onUnauthenticated
}

export const getCredentialRevision = () => _revision
export const isCredentialCurrent = (revision: CredentialRevision) => revision === _revision

function installAccessToken(token: string | null, expected: CredentialRevision): CredentialRevision | null {
  if (!isCredentialCurrent(expected)) return null
  _accessToken = token
  _revision = Symbol('credentials')
  return _revision
}

export function setAccessToken(token: string | null, expected = _revision): CredentialRevision | null {
  const revision = installAccessToken(token, expected)
  if (revision) _ownership = Symbol('credential ownership')
  return revision
}

export function clearTokens(expected = _revision): CredentialRevision | null {
  // The refresh cookie is cleared server-side on /logout.
  return setAccessToken(null, expected)
}

let mockSend: Promise<(r: RawRequest) => Promise<RawResponse>> | null = null

async function send(r: RawRequest, revision: CredentialRevision): Promise<RawResponse | null> {
  if (!isCredentialCurrent(revision)) return null
  if (__MOCK__) {
    mockSend ??= import('./mock').then((m) => m.mockSend)
    const transport = await mockSend
    return isCredentialCurrent(revision) ? transport(r) : null
  }
  return r.form ? sendForm(r) : sendJson(r)
}

function sendOwned(r: RawRequest, revision: CredentialRevision): Promise<RawResponse | null> {
  // These are all current server rt Set-Cookie/delete_cookie routes. Serialize full
  // responses: ignoring a stale result cannot undo a browser-applied Set-Cookie.
  const changesCookie = (r.method === 'POST' && ['/auth/login', '/auth/logout', '/auth/refresh'].includes(r.path))
    || (r.method === 'DELETE' && r.path === '/users/me')
  if (!changesCookie) return send(r, revision)
  const pending = _cookieRequests.then(() => send(r, revision))
  _cookieRequests = pending.then(() => undefined, () => undefined)
  return pending
}

async function sendJson(r: RawRequest): Promise<RawResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (r.token) headers.Authorization = `Bearer ${r.token}`
  let res: Response
  try {
    res = await fetch(`${BASE}${r.path}`, {
      method: r.method,
      headers,
      credentials: 'include',
      body: r.body !== undefined ? JSON.stringify(r.body) : undefined,
    })
  } catch {
    throw networkError(_dict)
  }
  if (r.blob && res.ok) return { status: res.status, data: await res.blob() }
  const text = res.status === 204 ? '' : await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null // an HTML error page from a proxy: the status picks the message
  }
  return { status: res.status, data, retryAfter: res.headers.get('Retry-After') }
}

// XMLHttpRequest instead of fetch for one reason: fetch cannot report *upload*
// progress, and an installer weighs tens of megabytes. The browser sets the
// multipart Content-Type with its boundary.
function sendForm(r: RawRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(r.method, `${BASE}${r.path}`)
    xhr.withCredentials = true
    if (r.token) xhr.setRequestHeader('Authorization', `Bearer ${r.token}`)
    const report = r.onProgress
    if (report) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) report(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onload = () => {
      let data: unknown = null
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        data = null
      }
      resolve({ status: xhr.status, data, retryAfter: xhr.getResponseHeader('Retry-After') })
    }
    xhr.onerror = () => reject(networkError(_dict))
    xhr.onabort = () => reject(networkError(_dict, true))
    xhr.send(r.form ?? null)
  })
}

/** Refresh coalesces only within the exact credential revision that started it. */
export function refreshTokens(expected = _revision): Promise<RefreshOutcome> {
  if (!isCredentialCurrent(expected)) return Promise.resolve({ kind: 'stale' })
  if (_refreshing?.revision === expected) return _refreshing.promise
  const promise = rotateTokens(expected)
  const refreshing = { revision: expected, promise }
  _refreshing = refreshing
  void promise.finally(() => { if (_refreshing === refreshing) _refreshing = null })
  return promise
}

type AccessIdentity = { subject: string; sessionId: string }

/** Consistency check for server-issued TLS credentials, NOT signature verification
 * or authorization. Expired access claims still bind an ordinary rotation. */
function accessIdentity(token: string): AccessIdentity | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || parts.some((part) => !part || !/^[A-Za-z0-9_-]+$/.test(part))) return null
    const payload: unknown = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (!payload || typeof payload !== 'object'
      || !('type' in payload) || payload.type !== 'access'
      || !('sub' in payload) || typeof payload.sub !== 'string' || !payload.sub
      || !('sid' in payload) || typeof payload.sid !== 'string' || !payload.sid) return null
    return { subject: payload.sub, sessionId: payload.sid }
  } catch {
    return null
  }
}

async function rotateTokens(expected: CredentialRevision): Promise<RefreshOutcome> {
  const previousToken = _accessToken
  const previousIdentity = previousToken === null ? null : accessIdentity(previousToken)
  try {
    const res = await sendOwned({ method: 'POST', path: '/auth/refresh', body: {}, token: null }, expected)
    if (!res || !isCredentialCurrent(expected)) return { kind: 'stale' }
    const data = res.data
    if (res.status >= 200 && res.status < 300 && data && typeof data === 'object'
      && 'access_token' in data && typeof data.access_token === 'string' && data.access_token) {
      const nextIdentity = accessIdentity(data.access_token)
      if (!nextIdentity || (previousToken !== null && (!previousIdentity
        || previousIdentity.subject !== nextIdentity.subject || previousIdentity.sessionId !== nextIdentity.sessionId))) {
        // A shared cookie may now belong to another tab's login. Retire only our
        // revision/UI; never install its bearer, logout, or delete its cookie.
        const revision = clearTokens(expected)
        if (!revision) return { kind: 'stale' }
        _onUnauthenticated?.(revision)
        return { kind: 'rejected', revision }
      }
      const revision = installAccessToken(data.access_token, expected)
      return revision ? { kind: 'refreshed', accessToken: data.access_token, revision } : { kind: 'stale' }
    }
  } catch { /* A rejected transport may only clear the credentials that started it. */ }
  const revision = clearTokens(expected)
  return revision ? { kind: 'rejected', revision } : { kind: 'stale' }
}

const sessionExpired = () => new ApiError({ status: 401, message: _dict.errors.sessionExpired })

type RequestCredentials = { revision: CredentialRevision; token: string | null; ownership: symbol }
const requestCredentials = (): RequestCredentials => ({ revision: _revision, token: _accessToken, ownership: _ownership })

async function call<T>(r: Omit<RawRequest, 'token'>, retry = true,
  credentials: RequestCredentials = requestCredentials()): Promise<T> {
  const res = await sendOwned({ ...r, token: credentials.token }, credentials.revision)
  if (!res) throw sessionExpired()
  const authAction = r.path === '/auth/login' || r.path === '/auth/logout'
  if (res.status === 401 && !authAction && credentials.token) {
    if (credentials.ownership !== _ownership) throw sessionExpired()
    if (retry) {
      // Another request may have completed a verified rotation before this 401.
      // Retry with its current bearer, never refresh the obsolete revision.
      if (!isCredentialCurrent(credentials.revision) && _accessToken) {
        return call<T>(r, false, requestCredentials())
      }
      const outcome = await refreshTokens(credentials.revision)
      if (outcome.kind === 'refreshed' && credentials.ownership === _ownership && _accessToken) {
        return call<T>(r, false, requestCredentials())
      }
      if (outcome.kind === 'rejected' && isCredentialCurrent(outcome.revision)) _onUnauthenticated?.(outcome.revision)
    } else if (isCredentialCurrent(credentials.revision)) {
      _onUnauthenticated?.(credentials.revision)
    }
    throw sessionExpired()
  }

  if (res.status >= 200 && res.status < 300) return (res.status === 204 ? undefined : res.data) as T
  throw toApiError(res.status, res.data, _dict, res.retryAfter)
}

/** Retire credentials immediately, but send logout with its captured old token only.
 * A later login waits for this response; logout never refreshes or retries as that login. */
export function logoutSession(): Promise<void> {
  const token = _accessToken
  const revision = clearTokens()
  if (!revision) return Promise.resolve()
  return call<void>({ method: 'POST', path: '/auth/logout' }, false, { revision, token, ownership: _ownership })
}

/** POST multipart with upload progress, with the same one-refresh-on-401 policy:
 *  an upload is long and the access token can expire halfway through it. */
export function uploadForm<T>(path: string, form: FormData, onProgress?: (percent: number) => void): Promise<T> {
  return call<T>({ method: 'POST', path, form, onProgress })
}

/** GET a file that needs the session, as a Blob. Support images use it: an <img src> cannot
 *  send the Bearer token. `path` may carry the /api/v1 prefix the server puts in its URLs. */
export const getBlob = (path: string) =>
  call<Blob>({ method: 'GET', path: path.startsWith(BASE) ? path.slice(BASE.length) : path, blob: true })

/** Low-level verbs. Prefer the typed functions in api/endpoints.ts. */
export const api = {
  get: <T>(path: string) => call<T>({ method: 'GET', path }),
  post: <T>(path: string, body?: unknown) => call<T>({ method: 'POST', path, body }),
  patch: <T>(path: string, body?: unknown) => call<T>({ method: 'PATCH', path, body }),
  delete: <T>(path: string, body?: unknown) => call<T>({ method: 'DELETE', path, body }),
}
