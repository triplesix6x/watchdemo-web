const BASE = '/api/v1'

// Access token: memory only — never written to any storage.
// Refresh token: sessionStorage — cleared on tab close.
// Trade-off: XSS can read sessionStorage. Ideal solution: httpOnly cookie
// set by a server-side proxy, but the backend returns RT in JSON body.
const RT_KEY = '_rt'

let _accessToken: string | null = null
let _onUnauthenticated: (() => void) | null = null
let _refreshing: Promise<boolean> | null = null

export function initClient(onUnauthenticated: () => void) {
  _onUnauthenticated = onUnauthenticated
}

export function setAccessToken(token: string | null) {
  _accessToken = token
}

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(RT_KEY)
}

export function setRefreshToken(token: string | null) {
  if (token) sessionStorage.setItem(RT_KEY, token)
  else sessionStorage.removeItem(RT_KEY)
}

export function clearTokens() {
  _accessToken = null
  sessionStorage.removeItem(RT_KEY)
}

async function doRefresh(): Promise<boolean> {
  const rt = getRefreshToken()
  if (!rt) return false
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    })
    if (!res.ok) {
      clearTokens()
      return false
    }
    const data: { access_token: string; refresh_token: string } = await res.json()
    setAccessToken(data.access_token)
    setRefreshToken(data.refresh_token)
    return true
  } catch {
    clearTokens()
    return false
  }
}

export async function refreshTokens(): Promise<{ access_token: string; refresh_token: string } | null> {
  const rt = getRefreshToken()
  if (!rt) return null
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    })
    if (!res.ok) { clearTokens(); return null }
    const data: { access_token: string; refresh_token: string } = await res.json()
    setAccessToken(data.access_token)
    setRefreshToken(data.refresh_token)
    return data
  } catch {
    clearTokens()
    return null
  }
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (_accessToken) headers['Authorization'] = `Bearer ${_accessToken}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  // Only attempt refresh if we actually had an access token — unauthenticated
  // requests (login, register…) that return 401 should surface the real error.
  if (res.status === 401 && retry && _accessToken) {
    if (!_refreshing) _refreshing = doRefresh().finally(() => { _refreshing = null })
    const ok = await _refreshing
    if (ok) return request<T>(method, path, body, false)
    _onUnauthenticated?.()
    throw new Error('Session expired. Please log in again.')
  }

  if (res.status === 204) return undefined as T

  const data: unknown = await res.json()
  if (!res.ok) {
    const err = data as { message?: string }
    throw new Error(err.message ?? `HTTP ${res.status}`)
  }
  return data as T
}

export function getCurrentSid(): string | null {
  if (!_accessToken) return null
  try {
    const base64 = _accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64)) as { sid?: string }
    return payload.sid ?? null
  } catch {
    return null
  }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
