const BASE = '/api/v1'

// Access token: memory only — never written to any storage.
// Refresh token: httpOnly cookie set by server — JS cannot read it.
// Non-browser clients: use refresh_token from response body directly.

let _accessToken: string | null = null
let _onUnauthenticated: (() => void) | null = null
let _refreshing: Promise<boolean> | null = null

export function initClient(onUnauthenticated: () => void) {
  _onUnauthenticated = onUnauthenticated
}

export function setAccessToken(token: string | null) {
  _accessToken = token
}

export function clearTokens() {
  _accessToken = null
  // RT cookie is cleared server-side on /logout
}

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    })
    if (!res.ok) {
      clearTokens()
      return false
    }
    const data: { access_token: string; refresh_token: string } = await res.json()
    setAccessToken(data.access_token)
    return true
  } catch {
    clearTokens()
    return false
  }
}

export async function refreshTokens(): Promise<{ access_token: string; refresh_token: string } | null> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    })
    if (!res.ok) { clearTokens(); return null }
    const data: { access_token: string; refresh_token: string } = await res.json()
    setAccessToken(data.access_token)
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
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

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

/**
 * Отправляет multipart-форму с отчётом о прогрессе.
 *
 * Здесь XMLHttpRequest, а не fetch, ровно по одной причине: fetch не умеет
 * сообщать прогресс *отправки*, а инсталлятор весит десятки мегабайт, и
 * заливка вслепую выглядит как зависший интерфейс. Content-Type не ставим —
 * его вместе с boundary проставит браузер.
 */
function sendForm<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
): Promise<{ status: number; data: T | { message?: string } }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}${path}`)
    xhr.withCredentials = true
    if (_accessToken) xhr.setRequestHeader('Authorization', `Bearer ${_accessToken}`)

    if (onProgress) {
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      let data: unknown = null
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        data = { message: `HTTP ${xhr.status}` }
      }
      resolve({ status: xhr.status, data: data as T })
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onabort = () => reject(new Error('Upload aborted'))
    xhr.send(form)
  })
}

/**
 * POST multipart с той же политикой протухшего токена, что и у request():
 * одна попытка refresh на 401. Заливка длинная, и access-токен вполне
 * успевает истечь прямо посреди неё.
 */
export async function uploadForm<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  let res = await sendForm<T>(path, form, onProgress)

  if (res.status === 401 && _accessToken) {
    if (!_refreshing) _refreshing = doRefresh().finally(() => { _refreshing = null })
    const ok = await _refreshing
    if (!ok) {
      _onUnauthenticated?.()
      throw new Error('Session expired. Please log in again.')
    }
    res = await sendForm<T>(path, form, onProgress)
  }

  if (res.status < 200 || res.status >= 300) {
    const err = res.data as { message?: string }
    throw new Error(err?.message ?? `HTTP ${res.status}`)
  }
  return res.data as T
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
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
