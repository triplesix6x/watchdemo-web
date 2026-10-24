import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import type { ApiError } from '../api/errors'

export type AsyncState<T> = {
  data: T | undefined
  error: ApiError | undefined
  loading: boolean
  /** Fetch again. Use it only when the server may know something the page does not. */
  reload: () => void
  /** Edit the loaded data in place (an optimistic change, or a mutation's response).
   *  The next load replaces it. No-op before the first load. */
  mutate: (fn: (data: T) => T) => void
  /** Fetch again in the background, without the loading state (polling). A failure keeps
   *  what is shown. */
  refresh: () => void
}

/** Load data on the client: `const { data, error, loading, reload } = useAsync(() => adminApi.stats(), [])`.
 *  A stale response (deps changed meanwhile) is dropped. Nothing runs on the server, so a
 *  prerendered page renders its loading shell first and the same shell hydrates. */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: true })
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  // Bumped on every load, so a refresh that started before the deps changed is dropped.
  const gen = useRef(0)
  useEffect(() => {
    gen.current++
    let live = true
    setState((s) => ({ ...s, loading: true }))
    fnRef.current().then(
      (data) => live && setState({ data, loading: false }),
      (error: ApiError) => live && setState({ error, loading: false }),
    )
    return () => {
      live = false
    }
  }, [...deps, tick])
  const reload = useCallback(() => setTick((n) => n + 1), [])
  const mutate = useCallback((edit: (data: T) => T) => setState((s) => (s.data === undefined ? s : { ...s, data: edit(s.data) })), [])
  const refresh = useCallback(() => {
    const at = gen.current
    fnRef.current().then(
      (data) => at === gen.current && setState((s) => ({ ...s, data, error: undefined })),
      () => {},
    )
  }, [])
  return { data: state.data, error: state.error, loading: state.loading, reload, mutate, refresh }
}
