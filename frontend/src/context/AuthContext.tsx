import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import { initClient, setAccessToken, clearTokens, refreshTokens } from '../api/client'
import { authApi, meApi } from '../api/endpoints'
import type { User } from '../api/types'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (login: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  /** Replace the cached user, e.g. with the response of PATCH /users/me. */
  setUser: (user: User) => void
}

const AuthContext = createContext<AuthContextType | null>(null)

// Restoring the session from the httpOnly refresh cookie starts when this module loads,
// before React's first render, so the cabinet waits on the network, not on the render.
// One shared promise, so StrictMode's second effect run reuses it.
type Restored = { user: User; accessToken: string } | null
const restoreSession = (): Promise<Restored> =>
  refreshTokens()
    .then(async (data) => (data ? { user: await meApi.get(), accessToken: data.access_token } : null))
    .catch(() => null)
let restoring: Promise<Restored> | null = typeof window === 'undefined' ? null : restoreSession()

function parseTokenTtlMs(token: string): number {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64)) as { exp: number }
    return payload.exp * 1000 - Date.now()
  } catch {
    return 14 * 60 * 1000
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearRefreshTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const handleUnauthenticated = useCallback(() => {
    clearRefreshTimer()
    clearTokens()
    setUser(null)
  }, [])

  const scheduleRefresh = useCallback((accessToken: string) => {
    clearRefreshTimer()
    const ttl = parseTokenTtlMs(accessToken)
    const delay = Math.max(ttl - 60_000, 5_000)
    timerRef.current = setTimeout(async () => {
      const data = await refreshTokens()
      if (data) {
        scheduleRefresh(data.access_token)
      } else {
        handleUnauthenticated()
      }
    }, delay)
  }, [handleUnauthenticated])

  useEffect(() => {
    initClient(handleUnauthenticated)

    let live = true
    restoring ??= restoreSession()
    restoring.then((r) => {
      if (!live) return
      if (r) {
        scheduleRefresh(r.accessToken)
        setUser(r.user)
      }
      setIsLoading(false)
    })
    return () => {
      live = false
    }
  }, [handleUnauthenticated, scheduleRefresh])

  const login = async (loginVal: string, password: string) => {
    const data = await authApi.login(loginVal, password)
    // Server sets httpOnly RT cookie automatically.
    // access_token kept in memory only.
    setAccessToken(data.access_token)
    setUser(data.user)
    scheduleRefresh(data.access_token)
  }

  const logout = async () => {
    try { await authApi.logout() } catch { /* session may already be gone */ }
    // Server clears RT cookie on /logout.
    clearRefreshTimer()
    clearTokens()
    setUser(null)
  }

  const refreshUser = async () => {
    setUser(await meApi.get())
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refreshUser, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
