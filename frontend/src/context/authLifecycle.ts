import type * as client from '../api/client.ts'
import type { authApi, meApi } from '../api/endpoints.ts'
import type { User } from '../api/types.ts'
import type { AuthSession, AuthSessionStore } from './authSession.ts'

type AuthDependencies = {
  sessions: AuthSessionStore
  credentials: Pick<typeof client, 'getCredentialRevision' | 'isCredentialCurrent' | 'setAccessToken' | 'clearTokens' | 'refreshTokens'>
  loginRequest: typeof authApi.login
  logoutRequest: typeof authApi.logout
  getUser: typeof meApi.get
  onUser: (user: User | null) => void
  onToken: (token: string | null) => void
}

/** Auth transition ownership is separate from token revisions: rotation must not
 * retire an active staff confirmation, but logout/relogin (even the same ID) must. */
export function createAuthActions(deps: AuthDependencies) {
  const { sessions, credentials, onUser, onToken } = deps
  const retire = () => {
    const transition = sessions.clear()
    onToken(null)
    onUser(null)
    return transition
  }
  const unauthenticated = (revision: client.CredentialRevision) => {
    if (!credentials.isCredentialCurrent(revision)) return
    retire()
    credentials.clearTokens(revision)
  }
  let restoring: Promise<void> | null = null
  return {
    unauthenticated,
    restore: () => {
      restoring ??= (async () => {
        const transition = sessions.getTransition()
        const outcome = await credentials.refreshTokens()
        if (!sessions.isCurrentTransition(transition)) return
        if (outcome.kind === 'rejected') { unauthenticated(outcome.revision); return }
        if (outcome.kind !== 'refreshed' || !credentials.isCredentialCurrent(outcome.revision)) return
        onToken(outcome.accessToken)
        const userRevision = credentials.getCredentialRevision()
        try {
          const user = await deps.getUser()
          if (!sessions.isCurrentTransition(transition)) return
          sessions.activate(user.id, transition)
          onUser(user)
        } catch {
          if (sessions.isCurrentTransition(transition) && credentials.isCredentialCurrent(userRevision)) {
            retire()
            credentials.clearTokens(userRevision)
          }
        }
      })()
      return restoring
    },
    login: async (login: string, password: string) => {
      const transition = retire()
      const revision = credentials.clearTokens()
      if (!revision) return
      const data = await deps.loginRequest(login, password)
      if (!sessions.isCurrentTransition(transition) || !credentials.isCredentialCurrent(revision)) return
      if (!credentials.setAccessToken(data.access_token, revision)) return
      sessions.activate(data.user.id, transition)
      onUser(data.user)
      onToken(data.access_token)
    },
    logout: async () => {
      retire()
      // The client captures the old token and retires credentials synchronously;
      // no completion handler can clear a newer login.
      try { await deps.logoutRequest() } catch { /* session may already be gone */ }
    },
    refreshUser: async () => {
      const activation = sessions.getSnapshot()
      if (!activation) return
      const user = await deps.getUser()
      if (sessions.getSnapshot() === activation && user.id === activation.actorId) onUser(user)
    },
    setUser: (user: User, activation: AuthSession | null) => {
      if (activation && sessions.getSnapshot() === activation && activation.actorId === user.id) onUser(user)
    },
  }
}
