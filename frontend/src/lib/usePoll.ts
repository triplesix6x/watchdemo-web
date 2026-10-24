import { useEffect, useRef } from 'react'

/** Calls `fn` every `ms` while the tab is visible, and once right away when it becomes
 *  visible again. The support chat, inbox and unread badge poll through it. */
export function usePoll(fn: () => void, ms: number, enabled = true) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!enabled) return
    let id: ReturnType<typeof setInterval> | undefined
    const stop = () => {
      clearInterval(id)
      id = undefined
    }
    const start = () => {
      stop()
      if (document.visibilityState === 'visible') id = setInterval(() => ref.current(), ms)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') ref.current()
      start()
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ms, enabled])
}
