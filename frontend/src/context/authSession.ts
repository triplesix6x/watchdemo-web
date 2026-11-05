export type AuthSession = Readonly<{ actorId: string; generation: number }>

/** Opaque UI activation identity, not a credential; token refresh does not replace it. */
export function createAuthSessionStore() {
  let current: AuthSession | null = null
  let generation = 0
  let transition = Symbol('auth transition')
  const listeners = new Set<() => void>()
  const publish = () => listeners.forEach((listener) => listener())
  return {
    getSnapshot: () => current,
    getTransition: () => transition,
    isCurrentTransition: (expected: symbol) => transition === expected,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    activate: (actorId: string, expected = transition) => {
      if (transition !== expected) return null
      transition = Symbol('auth transition')
      current = { actorId, generation: ++generation }
      publish()
      return current
    },
    clear: () => {
      transition = Symbol('auth transition')
      current = null
      publish()
      return transition
    },
  }
}

export type AuthSessionStore = ReturnType<typeof createAuthSessionStore>
export const authSessions = createAuthSessionStore()
export const noAuthSession = () => null
