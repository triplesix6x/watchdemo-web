import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import * as credentials from '../api/client'
import { authApi, meApi } from '../api/endpoints'
import type { User } from '../api/types'
import { authSessions, noAuthSession } from './authSession'
import { createAuthActions } from './authLifecycle'

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
  const [refreshToken, setRefreshToken] = useState<string | null>(null)
  const activation = useSyncExternalStore(authSessions.subscribe, authSessions.getSnapshot, noAuthSession)
  const actions = useMemo(() => createAuthActions({
    sessions: authSessions, credentials,
    loginRequest: authApi.login, logoutRequest: authApi.logout, getUser: meApi.get,
    onUser: setUser, onToken: setRefreshToken,
  }), [])

  useEffect(() => {
    credentials.initClient(actions.unauthenticated)
    let live = true
    // The action owns one restoration promise, reused by StrictMode's effect replay.
    void actions.restore().finally(() => { if (live) setIsLoading(false) })
    return () => { live = false }
  }, [actions])

  useEffect(() => {
    if (!refreshToken || !activation) return
    const expectedActivation = activation
    const timer = setTimeout(async () => {
      if (authSessions.getSnapshot() !== expectedActivation) return
      const outcome = await credentials.refreshTokens()
      if (authSessions.getSnapshot() !== expectedActivation) return
      if (outcome.kind === 'refreshed' && credentials.isCredentialCurrent(outcome.revision)) {
        setRefreshToken(outcome.accessToken)
      } else if (outcome.kind === 'rejected') {
        actions.unauthenticated(outcome.revision)
      }
    }, Math.max(parseTokenTtlMs(refreshToken) - 60_000, 5_000))
    return () => { clearTimeout(timer) }
  }, [refreshToken, activation, actions])

  return (
    <AuthContext.Provider value={{
      user, isLoading, login: actions.login, logout: actions.logout, refreshUser: actions.refreshUser,
      // A Profile handler retains this render's activation across its PATCH await.
      setUser: (next) => actions.setUser(next, activation),
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
