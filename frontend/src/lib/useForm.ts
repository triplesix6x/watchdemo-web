// Blur-first form state. A field shows its error only after it was left (or on submit),
// and the error clears on the first edit. Submit is never disabled: an invalid submit
// shows every error and focuses the first broken field.
import { useRef, useState, type FormEvent } from 'react'
import { ApiError, type ErrorCode } from '../api/errors'

/** Returns the message to show, or null when the value is fine. */
export type Validator<K extends string> = (value: string, all: Record<K, string>) => string | null

/**
 * `codeToField` puts a server error under the field it is about (`{ wrong_password: 'password' }`);
 * a 422 with field details lands by field name on its own.
 */
export function useForm<K extends string>(
  initial: Record<K, string>,
  rules: Partial<Record<K, Validator<K>>>,
  codeToField: Partial<Record<ErrorCode, K>> = {},
) {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  // A server error no field took: show it above the submit button.
  const [failure, setFailure] = useState<string | null>(null)
  const inFlight = useRef(false)

  const check = (name: K, all = values) => rules[name]?.(all[name], all) ?? null

  const field = (name: K) => ({
    name,
    value: values[name],
    onChange: (e: { target: { value: string } }) => {
      const value = e.target.value
      setValues((v) => ({ ...v, [name]: value }))
      if (errors[name]) setErrors((x) => ({ ...x, [name]: undefined }))
    },
    onBlur: () => setErrors((x) => ({ ...x, [name]: check(name) ?? undefined })),
  })

  /** Moves a server error under its field. Returns the message no field took, or null. */
  const absorb = (err: ApiError): string | null => {
    const mine = Object.fromEntries(Object.entries(err.fields).filter(([k]) => k in values)) as Partial<Record<K, string>>
    const routed = err.code && codeToField[err.code]
    if (routed) mine[routed] = err.message
    if (!Object.keys(mine).length) return err.message
    setErrors((x) => ({ ...x, ...mine }))
    return null
  }

  /** Wraps a submit handler: validates first and runs `fn` only when clean. While `fn` runs,
   *  `submitting` is true; an ApiError it throws lands under a field or in `failure`. */
  const onSubmit = (fn: (values: Record<K, string>) => void | Promise<void>) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (inFlight.current) return
    const next: Partial<Record<K, string>> = {}
    for (const name of Object.keys(values) as K[]) {
      const err = check(name)
      if (err) next[name] = err
    }
    setErrors(next)
    const first = (Object.keys(values) as K[]).find((n) => next[n])
    if (first) {
      ;(e.currentTarget.elements.namedItem(first) as HTMLElement | null)?.focus()
      return
    }
    inFlight.current = true
    setSubmitting(true)
    setFailure(null)
    try {
      await fn(values)
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      setFailure(absorb(err))
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  const reset = () => {
    setValues(initial)
    setErrors({})
    setFailure(null)
  }

  return { values, errors, submitting, failure, field, onSubmit, reset, set: setValues, setErrors }
}
