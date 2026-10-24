// HTTP client for /api/v1.
// Access token: memory only, never written to any storage.
// Refresh token: httpOnly cookie set by the server, JS cannot read it.
// Every failure becomes an ApiError whose message is human text in the UI language.
// With VITE_MOCK_API=1 the transport is swapped for in-memory fixtures (api/mock); the
// __MOCK__ constant is false in normal builds, so the mock code is dropped from the bundle.
import { ApiError, networkError, toApiError } from './errors'
import { ru, type Dict } from '../i18n/ru'
import { en } from '../i18n/en'

export const BASE = '/api/v1'

export type RawResponse = { status: number; data: unknown; retryAfter?: string | null }
export type RawRequest = {
  method: string
  path: string
  body?: unknown
  form?: FormData
  token: string | null
  onProgress?: (percent: number) => void
}

let _accessToken: string | null = null
let _onUnauthenticated: (() => void) | null = null
let _refreshing: Promise<boolean> | null = null
let _dict: Dict = ru

export function setApiLocale(locale: 'ru' | 'en') {
  _dict = locale === 'en' ? en : ru
}

export function initClient(onUnauthenticated: () => void) {
  _onUnauthenticated = onUnauthenticated
}

export function setAccessToken(token: string | null) {
  _accessToken = token
}

export function clearTokens() {
  _accessToken = null
  // The refresh cookie is cleared server-side on /logout.
}

let mockSend: Promise<(r: RawRequest) => Promise<RawResponse>> | null = null

async function send(r: RawRequest): Promise<RawResponse> {
  if (__MOCK__) {
    mockSend ??= import('./mock').then((m) => m.mockSend)
    return (await mockSend)(r)
  }
  return r.form ? sendForm(r) : sendJson(r)
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

/** Refresh by cookie. AuthContext calls it on start and on its timer. */
export async function refreshTokens(): Promise<{ access_token: string; refresh_token: string } | null> {
  try {
    const res = await send({ method: 'POST', path: '/auth/refresh', body: {}, token: null })
    if (res.status < 200 || res.status >= 300) {
      clearTokens()
      return null
    }
    const data = res.data as { access_token: string; refresh_token: string }
    setAccessToken(data.access_token)
    return data
  } catch {
    clearTokens()
    return null
  }
}

async function call<T>(r: Omit<RawRequest, 'token'>, retry = true): Promise<T> {
  const res = await send({ ...r, token: _accessToken })

  if (res.status === 401 && retry && _accessToken) {
    _refreshing ??= refreshTokens()
      .then(Boolean)
      .finally(() => {
        _refreshing = null
      })
    if (await _refreshing) return call<T>(r, false)
    _onUnauthenticated?.()
    throw new ApiError({ status: 401, message: _dict.errors.sessionExpired })
  }

  if (res.status >= 200 && res.status < 300) return (res.status === 204 ? undefined : res.data) as T
  throw toApiError(res.status, res.data, _dict, res.retryAfter)
}

/** POST multipart with upload progress, with the same one-refresh-on-401 policy:
 *  an upload is long and the access token can expire halfway through it. */
export function uploadForm<T>(path: string, form: FormData, onProgress?: (percent: number) => void): Promise<T> {
  return call<T>({ method: 'POST', path, form, onProgress })
}

/** GET a file that needs the session, as a Blob. Support images use it: an <img src> cannot
 *  send the Bearer token. `path` may carry the /api/v1 prefix the server puts in its URLs. */
export async function getBlob(path: string, retry = true): Promise<Blob> {
  const rel = path.startsWith(BASE) ? path.slice(BASE.length) : path
  if (__MOCK__) {
    const res = await send({ method: 'GET', path: rel, token: _accessToken })
    if (res.status !== 200) throw toApiError(res.status, res.data, _dict)
    return res.data as Blob
  }
  let res: Response
  try {
    res = await fetch(`${BASE}${rel}`, { headers: _accessToken ? { Authorization: `Bearer ${_accessToken}` } : {}, credentials: 'include' })
  } catch {
    throw networkError(_dict)
  }
  if (res.status === 401 && retry && _accessToken && (await refreshTokens())) return getBlob(path, false)
  if (!res.ok) throw toApiError(res.status, await res.json().catch(() => null), _dict)
  return res.blob()
}

/** Low-level verbs. Prefer the typed functions in api/endpoints.ts. */
export const api = {
  get: <T>(path: string) => call<T>({ method: 'GET', path }),
  post: <T>(path: string, body?: unknown) => call<T>({ method: 'POST', path, body }),
  patch: <T>(path: string, body?: unknown) => call<T>({ method: 'PATCH', path, body }),
  delete: <T>(path: string, body?: unknown) => call<T>({ method: 'DELETE', path, body }),
}
