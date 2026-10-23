import { appApi } from '../api/endpoints'
import type { LatestRelease } from '../api/types'
import { useAuth } from '../context/AuthContext'
import { useAsync } from './useAsync'

// The footer and the page above it ask together: one request per signed-in user (a beta
// tester gets the beta build), dropped on failure so a retry asks again.
let shared: { user: string | null; p: Promise<LatestRelease> } | null = null

function latestFor(user: string | null) {
  if (shared?.user !== user) {
    const p = appApi.latest()
    shared = { user, p }
    p.catch(() => {
      if (shared?.p === p) shared = null
    })
  }
  return shared.p
}

const never = new Promise<never>(() => {})

/** The latest Windows build for this visitor. Stays loading until the session is known,
 *  so a beta tester never sees the stable card flash first. */
export function useLatestRelease() {
  const { user, isLoading } = useAuth()
  const id = user?.id ?? null
  return useAsync(() => (isLoading ? never : latestFor(id)), [isLoading, id])
}
