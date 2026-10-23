// Email links (verify, confirm email change) carry a one-time token. Opening the page
// spends it, so the request runs once per token even when React mounts the effect twice
// (StrictMode, a fast back-and-forth); later mounts reuse the first result.
import { useEffect, useState } from 'react'
import type { ApiError } from '../../api/errors'

export type LinkState = { status: 'pending' } | { status: 'done' } | { status: 'failed'; error: ApiError }

const spent = new Map<string, Promise<unknown>>()

export function useTokenLink(kind: string, token: string | null, run: (token: string) => Promise<unknown>): LinkState | null {
  const [state, setState] = useState<LinkState | null>(token ? { status: 'pending' } : null)
  useEffect(() => {
    if (!token) return
    const key = `${kind}:${token}`
    if (!spent.has(key)) spent.set(key, run(token))
    let live = true
    spent.get(key)!.then(
      () => live && setState({ status: 'done' }),
      (error: ApiError) => live && setState({ status: 'failed', error }),
    )
    return () => {
      live = false
    }
    // `run` is a fresh closure each render; the token alone decides when to run.
  }, [kind, token])
  return state
}
