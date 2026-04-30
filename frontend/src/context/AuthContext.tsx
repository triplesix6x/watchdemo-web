import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import {
  api,
  initClient,
  setAccessToken,
  clearTokens,
  refreshTokens,
} from '../api/client'
import type { User } from '../types'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (login: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

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

    // Try to restore session using httpOnly cookie — no storage check needed.
    refreshTokens()
      .then((data) => {
        if (!data) return
        scheduleRefresh(data.access_token)
        return api.get<User>('/users/me')
      })
      .then((u) => { if (u) setUser(u) })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [handleUnauthenticated, scheduleRefresh])

  const login = async (loginVal: string, password: string) => {
    const data = await api.post<{
      access_token: string
      refresh_token: string
      user: User
    }>('/auth/login', { login: loginVal, password })
    // Server sets httpOnly RT cookie automatically.
    // access_token kept in memory only.
    setAccessToken(data.access_token)
    setUser(data.user)
    scheduleRefresh(data.access_token)
  }

  const logout = async () => {
    try { await api.post('/auth/logout') } catch { /* session may already be gone */ }
    // Server clears RT cookie on /logout.
    clearRefreshTimer()
    clearTokens()
    setUser(null)
  }

  const refreshUser = async () => {
    const u = await api.get<User>('/users/me')
    setUser(u)
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
