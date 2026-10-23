// Shared plumbing of the admin pages: the page dictionary and one way to run an action
// with a toast.
import { useCallback, useState } from 'react'
import { ApiError } from '../../api/errors'
import { useDict, useT } from '../../i18n'
import { useToast } from '../../ui'
import ru from '../../i18n/pages/admin.ru'
import en from '../../i18n/pages/admin.en'

export type AdminDict = typeof ru

export const useAdminDict = () => useDict({ ru, en })

/** `run(() => adminApi.x(), 'Done')`: toasts success or the mapped error, returns the result
 *  (undefined on failure). `busy` holds the key of the action in flight. */
export function useAdminAction() {
  const toast = useToast()
  const t = useT()
  const [busy, setBusy] = useState<string | null>(null)
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> => {
      setBusy(key)
      try {
        const r = await fn()
        if (success) toast(typeof success === 'function' ? success(r) : success, { tone: 'success' })
        return r
      } catch (e) {
        toast(e instanceof ApiError ? e.message : t.errors.unknown, { tone: 'error' })
        return undefined
      } finally {
        setBusy(null)
      }
    },
    [toast, t],
  )
  return { run, busy }
}
