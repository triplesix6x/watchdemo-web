// Turns any failed response into an ApiError with human text in the UI language.
// Every error body is {message, code, ...extra} (docs/ERROR-CODES.md): the text is picked
// by `code`; `message` is English for logs and never shown. A 422 validation_failed also
// carries FastAPI's {detail: [{loc, msg, type, ctx}]}, which becomes per-field text.
import type { Dict } from '../i18n/ru'
import { fmt } from '../i18n/fmt.ts'

/** Mirror of ErrorCode in web/APP/exceptions.py. errors.check.ts compares it with the doc. */
export const Code = {
  INVALID_CREDENTIALS: 'invalid_credentials',
  TOO_MANY_ATTEMPTS: 'too_many_attempts',
  EMAIL_NOT_VERIFIED: 'email_not_verified',
  ACCOUNT_DEACTIVATED: 'account_deactivated',
  INVALID_PASSWORD: 'invalid_password',
  PASSWORD_WEAK: 'password_weak',
  EMAIL_TAKEN: 'email_taken',
  USERNAME_TAKEN: 'username_taken',
  EMAIL_UNCHANGED: 'email_unchanged',
  USERNAME_MISMATCH: 'username_mismatch',
  USER_NOT_FOUND: 'user_not_found',
  SESSION_NOT_FOUND: 'session_not_found',
  TOKEN_MISSING: 'token_missing',
  TOKEN_INVALID: 'token_invalid',
  TOKEN_EXPIRED: 'token_expired',
  SESSION_REVOKED: 'session_revoked',
  INSUFFICIENT_ROLE: 'insufficient_role',
  CANNOT_TARGET_SELF: 'cannot_target_self',
  TARGET_ROLE_TOO_HIGH: 'target_role_too_high',
  TARGET_DEACTIVATED: 'target_deactivated',
  SUBSCRIPTION_NOT_FOUND: 'subscription_not_found',
  TIER_HAS_NO_EXPIRY: 'tier_has_no_expiry',
  SUBSCRIPTION_NO_EXPIRY: 'subscription_no_expiry',
  RELEASE_NOT_FOUND: 'release_not_found',
  RELEASE_DUPLICATE: 'release_duplicate',
  RELEASE_BAD_VERSION: 'release_bad_version',
  RELEASE_BAD_PLATFORM: 'release_bad_platform',
  RELEASE_BAD_SIGNATURE: 'release_bad_signature',
  RELEASE_TOO_LARGE: 'release_too_large',
  RELEASE_EMPTY_FILE: 'release_empty_file',
  SUPPORT_TICKET_NOT_FOUND: 'support_ticket_not_found',
  SUPPORT_TICKET_CLOSED: 'support_ticket_closed',
  SUPPORT_TICKET_CONFLICT: 'support_ticket_conflict',
  SUPPORT_ASSIGNEE_INVALID: 'support_assignee_invalid',
  SUPPORT_EMPTY_MESSAGE: 'support_empty_message',
  SUPPORT_IMAGE_INVALID: 'support_image_invalid',
  SUPPORT_IMAGE_TOO_LARGE: 'support_image_too_large',
  SUPPORT_IMAGE_NOT_FOUND: 'support_image_not_found',
  VALIDATION_FAILED: 'validation_failed',
  RATE_LIMITED: 'rate_limited',
  HTTP_ERROR: 'http_error',
  INTERNAL_ERROR: 'internal_error',
} as const

export type ErrorCode = (typeof Code)[keyof typeof Code]

export class ApiError extends Error {
  /** HTTP status; 0 when the request never got a response. */
  readonly status: number
  /** The server's code; undefined for a body without one (a proxy page, a network failure). */
  readonly code?: ErrorCode
  /** Field name -> localized message, from a 422 body. Keys are the request field names. */
  readonly fields: Record<string, string>
  /** The server's own text, for logs. Never show it: `message` is the localized one. */
  readonly serverMessage?: string
  readonly retryAfter?: number
  readonly attemptsRemaining?: number

  constructor(init: {
    status: number
    code?: ErrorCode
    message: string
    fields?: Record<string, string>
    serverMessage?: string
    retryAfter?: number
    attemptsRemaining?: number
  }) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.fields = init.fields ?? {}
    this.serverMessage = init.serverMessage
    this.retryAfter = init.retryAfter
    this.attemptsRemaining = init.attemptsRemaining
  }
}

/** Extra fields of an error body that the text may use. */
type Extra = { seconds?: number; count?: number; rule?: string; status: number }

const PASSWORD_RULE_TEXT = (d: Dict, rule?: string) =>
  rule === 'uppercase' ? d.authErrors.passwordUpper : rule === 'digit' ? d.authErrors.passwordDigit : d.authErrors.passwordLength

const TEXT: Record<ErrorCode, (d: Dict, x: Extra) => string> = {
  invalid_credentials: (d, x) => (x.count !== undefined ? fmt(d.authErrors.attemptsLeft, { count: x.count }) : d.authErrors.invalidCredentials),
  too_many_attempts: (d, x) => (x.seconds ? fmt(d.authErrors.accountLocked, { seconds: x.seconds }) : d.errors.tooManyRequests),
  email_not_verified: (d) => d.authErrors.emailNotVerified,
  account_deactivated: (d) => d.authErrors.deactivated,
  invalid_password: (d) => d.authErrors.wrongPassword,
  password_weak: (d, x) => PASSWORD_RULE_TEXT(d, x.rule),
  email_taken: (d) => d.authErrors.emailTaken,
  username_taken: (d) => d.authErrors.usernameTaken,
  email_unchanged: (d) => d.authErrors.sameEmail,
  username_mismatch: (d) => d.authErrors.usernameMismatch,
  user_not_found: (d) => d.adminErrors.userNotFound,
  session_not_found: (d) => d.authErrors.sessionNotFound,
  token_missing: (d) => d.errors.sessionExpired,
  token_invalid: (d) => d.authErrors.tokenInvalid,
  token_expired: (d) => d.authErrors.tokenExpired,
  session_revoked: (d) => d.errors.sessionExpired,
  insufficient_role: (d) => d.errors.forbidden,
  cannot_target_self: (d) => d.authErrors.selfAction,
  target_role_too_high: (d) => d.authErrors.targetRoleTooHigh,
  target_deactivated: (d) => d.adminErrors.targetDeactivated,
  subscription_not_found: (d) => d.adminErrors.noSubscription,
  tier_has_no_expiry: (d) => d.adminErrors.basicNoExpiry,
  subscription_no_expiry: (d) => d.adminErrors.noExpiry,
  release_not_found: (d) => d.adminErrors.releaseNotFound,
  release_duplicate: (d) => d.adminErrors.duplicate,
  release_bad_version: (d) => d.adminErrors.badVersion,
  release_bad_platform: (d) => d.adminErrors.badPlatform,
  release_bad_signature: (d) => d.adminErrors.emptySignature,
  release_too_large: (d) => d.adminErrors.tooLarge,
  release_empty_file: (d) => d.adminErrors.emptyFile,
  support_ticket_not_found: (d) => d.supportErrors.ticketNotFound,
  support_ticket_closed: (d) => d.supportErrors.ticketClosed,
  support_ticket_conflict: (d) => d.supportErrors.ticketConflict,
  support_assignee_invalid: (d) => d.supportErrors.assigneeInvalid,
  support_empty_message: (d) => d.supportErrors.emptyMessage,
  support_image_invalid: (d) => d.supportErrors.imageInvalid,
  support_image_too_large: (d) => d.supportErrors.imageTooLarge,
  support_image_not_found: (d) => d.supportErrors.imageNotFound,
  validation_failed: (d) => d.errors.validation,
  rate_limited: (d, x) => (x.seconds ? fmt(d.errors.tooManyRequestsIn, { seconds: x.seconds }) : d.errors.tooManyRequests),
  http_error: (d, x) => byStatus(x.status, d),
  internal_error: (d) => d.errors.server,
}

/** Text for a body without a known code: a proxy error page, or a code newer than this site. */
function byStatus(status: number, d: Dict): string {
  if (status === 0) return d.errors.network
  if (status === 401) return d.errors.unauthorized
  if (status === 403) return d.errors.forbidden
  if (status === 404) return d.errors.notFound
  if (status === 409) return d.errors.conflict
  if (status === 422) return d.errors.badRequest
  if (status === 429) return d.errors.tooManyRequests
  if (status >= 500) return d.errors.server
  if (status >= 400) return d.errors.badRequest
  return d.errors.unknown
}

type PydanticIssue = { loc?: (string | number)[]; msg?: string; type?: string; ctx?: Record<string, unknown> }

function issueText(issue: PydanticIssue, d: Dict): string {
  const ctx = issue.ctx ?? {}
  switch (issue.type) {
    case 'missing':
      return d.validation.required
    case 'string_too_short':
      return fmt(d.validation.minLength, { min: Number(ctx.min_length ?? 0) })
    case 'string_too_long':
      return fmt(d.validation.maxLength, { max: Number(ctx.max_length ?? 0) })
  }
  // Field validators raise plain ValueErrors (web/API/views/auth/schemas.py), so their
  // issues carry no code of their own.
  const msg = issue.msg ?? ''
  if (/email/i.test(msg)) return d.validation.email
  if (/Username must be/i.test(msg)) return d.authErrors.usernameLength
  if (/Username may only/i.test(msg)) return d.authErrors.usernameChars
  return d.errors.badRequest
}

const isCode = (v: unknown): v is ErrorCode => typeof v === 'string' && v in TEXT

/** Build the ApiError for a non-2xx response. `body` is the parsed JSON or null. */
export function toApiError(status: number, body: unknown, d: Dict, retryAfterHeader?: string | null): ApiError {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const headerSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined
  const x: Extra = {
    status,
    seconds: typeof b.retry_after_seconds === 'number' ? b.retry_after_seconds : Number.isFinite(headerSeconds) ? headerSeconds : undefined,
    count: typeof b.attempts_remaining === 'number' ? b.attempts_remaining : undefined,
    rule: typeof b.rule === 'string' ? b.rule : undefined,
  }
  const code = isCode(b.code) ? b.code : undefined
  const serverMessage = typeof b.message === 'string' ? b.message : typeof b.detail === 'string' ? b.detail : undefined
  const base = { status, code, serverMessage, retryAfter: x.seconds, attemptsRemaining: x.count }

  if (code === Code.VALIDATION_FAILED && Array.isArray(b.detail)) {
    const fields: Record<string, string> = {}
    for (const issue of b.detail as PydanticIssue[]) {
      const loc = (issue.loc ?? []).filter((p) => p !== 'body' && p !== 'query' && p !== 'path')
      const key = loc.length ? String(loc[loc.length - 1]) : '_'
      fields[key] ??= issueText(issue, d)
    }
    const only = Object.keys(fields)
    const message = only.length === 1 ? fields[only[0]] : d.errors.validation
    return new ApiError({ ...base, message, fields, serverMessage: JSON.stringify(b.detail) })
  }

  return new ApiError({ ...base, message: code ? TEXT[code](d, x) : byStatus(status, d) })
}

/** For request failures without a response (offline, DNS, CORS, abort). */
export const networkError = (d: Dict, aborted = false) =>
  new ApiError({ status: 0, message: aborted ? d.errors.uploadAborted : d.errors.network })
