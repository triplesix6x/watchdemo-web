// The unread badge on the "Support" nav item: tickets with unread customer messages.
import { useCallback, useEffect, useState } from 'react'
import { supportAdminApi } from '../../api/endpoints'
import { usePoll } from '../../lib/usePoll'

const EVENT = 'wd:support-unread'

/** Ask the badge to refetch now (the inbox calls it after marking a ticket read). */
export const refreshSupportUnread = () => window.dispatchEvent(new Event(EVENT))

export function useSupportUnread(enabled: boolean): number {
  const [count, setCount] = useState(0)
  const load = useCallback(() => {
    supportAdminApi.unread().then(
      (r) => setCount(r.tickets),
      () => {},
    )
  }, [])
  useEffect(() => {
    if (!enabled) return
    load()
    addEventListener(EVENT, load)
    return () => removeEventListener(EVENT, load)
  }, [enabled, load])
  usePoll(load, 30_000, enabled)
  return enabled ? count : 0
}
