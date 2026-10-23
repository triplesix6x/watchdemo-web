// Client copies of the backend's input rules, so a form can say what is wrong before the
// round trip. Keep in sync with web/APP/services/auth_service.py (_validate_password) and
// web/API/views/auth/schemas.py (normalize_username). The server stays the authority.
import type { Dict } from '../../i18n/ru.ts'

export type PasswordRule = 'length' | 'upper' | 'digit'
export type UsernameRule = 'length' | 'chars'

export const PASSWORD_RULES: Record<PasswordRule, (pw: string) => boolean> = {
  length: (pw) => pw.length >= 10,
  upper: (pw) => /[A-Z]/.test(pw),
  digit: (pw) => /\p{Nd}/u.test(pw),
}

/** Python's str.isalnum() after removing _ and -: any Unicode letter or digit. */
export const USERNAME_RULES: Record<UsernameRule, (name: string) => boolean> = {
  length: (name) => name.trim().length >= 3 && name.trim().length <= 50,
  chars: (name) => /^[\p{L}\p{N}_-]+$/u.test(name.trim()),
}

/** The first rule a value breaks, or null. Order follows the object keys. */
export function firstBroken<R extends string>(rules: Record<R, (v: string) => boolean>, value: string): R | null {
  return (Object.keys(rules) as R[]).find((r) => !rules[r](value)) ?? null
}

/** Loose shape check; the server's EmailStr decides. */
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

/** `?next=` is only honoured for same-site paths: "/x" yes, "//evil.com" and "/\evil" no. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  return next
}

type RuleText = Pick<Dict, 'validation' | 'authErrors'>

/** The message a form shows under the field, or null when the value passes. */
export function passwordError(pw: string, t: RuleText): string | null {
  if (!pw) return t.validation.required
  const broken = firstBroken(PASSWORD_RULES, pw)
  return broken && { length: t.authErrors.passwordLength, upper: t.authErrors.passwordUpper, digit: t.authErrors.passwordDigit }[broken]
}

export function usernameError(name: string, t: RuleText): string | null {
  if (!name.trim()) return t.validation.required
  const broken = firstBroken(USERNAME_RULES, name)
  return broken && { length: t.authErrors.usernameLength, chars: t.authErrors.usernameChars }[broken]
}

export function emailError(email: string, t: RuleText): string | null {
  if (!email.trim()) return t.validation.required
  return isEmail(email) ? null : t.validation.email
}

export const requiredError = (v: string, t: RuleText): string | null => (v.trim() ? null : t.validation.required)
