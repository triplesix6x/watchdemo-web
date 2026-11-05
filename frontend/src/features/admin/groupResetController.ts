import { ApiError, type ErrorCode } from '../../api/errors.ts'
import type { GroupResetResponse } from '../../api/types.ts'
import { authSessions, type AuthSession, type AuthSessionStore } from '../../context/authSession.ts'

export type ResetConfirmation = Readonly<{ actorId: string; activation: AuthSession | null; targetId: string; username: string; identity: number }>
type ResetRequest = Readonly<{ confirmation: ResetConfirmation; identity: number }>
export type GroupResetState =
  | { kind: 'ready' }
  | { kind: 'pending'; request: ResetRequest }
  | { kind: 'succeeded'; request: ResetRequest; result: GroupResetResponse }
  | { kind: 'rejected'; request: ResetRequest; error: ApiError }
  | { kind: 'unknown'; request: ResetRequest }

const READY: GroupResetState = { kind: 'ready' }
const definiteCodes = new Set<ErrorCode>([
  'validation_failed', 'insufficient_role', 'cannot_target_self', 'target_role_too_high',
  'target_deactivated', 'user_not_found', 'token_missing', 'token_invalid', 'token_expired',
  'session_revoked', 'account_deactivated', 'rate_limited',
])

/** Only explicit pre-mutation refusals are safe to correct without outcome verification. */
export function isDefiniteResetRejection(error: unknown): error is ApiError {
  return error instanceof ApiError && [400, 401, 403, 404, 422, 429].includes(error.status)
    && error.code !== undefined && definiteCodes.has(error.code)
}

function resetResponse(value: unknown): GroupResetResponse | null {
  if (!value || typeof value !== 'object'
    || !('generation' in value) || !('removed_groups' in value) || !('cancelled_reservations' in value)) return null
  const { generation, removed_groups, cancelled_reservations } = value
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 0
    || typeof removed_groups !== 'number' || !Number.isSafeInteger(removed_groups) || removed_groups < 0
    || typeof cancelled_reservations !== 'number' || !Number.isSafeInteger(cancelled_reservations) || cancelled_reservations < 0) return null
  return { generation, removed_groups, cancelled_reservations }
}

export function resetCompletedFor(state: GroupResetState, confirmation: ResetConfirmation | null): boolean {
  return state.kind === 'succeeded' && state.request.confirmation === confirmation
}

/** Tab-memory barriers survive navigation AND auth replacement. A retired activation
 * cannot own completion or release an uncertain non-idempotent request for replay. */
export function createGroupResetController(sessions: AuthSessionStore = authSessions) {
  let identity = 0
  const states = new Map<string, GroupResetState>()
  const confirmations = new Map<string, ResetConfirmation>()
  const listeners = new Set<() => void>()
  const publish = (targetId: string, state: GroupResetState) => {
    states.set(targetId, state)
    listeners.forEach((listener) => listener())
  }
  const getSnapshot = (targetId: string) => states.get(targetId) ?? READY
  const openConfirmation = (actorId: string, targetId: string, username: string): ResetConfirmation => {
    const confirmation = { actorId, activation: sessions.getSnapshot(), targetId, username, identity: ++identity }
    confirmations.set(targetId, confirmation)
    return confirmation
  }

  const isCurrent = (confirmation: ResetConfirmation) => confirmation.activation !== null
    && sessions.getSnapshot() === confirmation.activation && confirmation.activation.actorId === confirmation.actorId

  return {
    getSnapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    openConfirmation,
    verifyOutcome: (confirmation: ResetConfirmation, expected: GroupResetState): ResetConfirmation | null => {
      const current = getSnapshot(confirmation.targetId)
      // An old recovery control must not release a newer request's safety barrier.
      if (!isCurrent(confirmation) || current !== expected || current.kind !== 'unknown' || confirmations.get(confirmation.targetId) !== confirmation) return null
      const fresh = openConfirmation(confirmation.actorId, confirmation.targetId, confirmation.username)
      publish(confirmation.targetId, READY)
      return fresh
    },
    submit: async (confirmation: ResetConfirmation, reason: string, send: (targetId: string, reason: string) => Promise<unknown>): Promise<void> => {
      const current = getSnapshot(confirmation.targetId)
      if (!isCurrent(confirmation) || confirmations.get(confirmation.targetId) !== confirmation || current.kind === 'pending' || current.kind === 'unknown') return
      if (!reason.trim() || reason.trim().length > 2000) return
      const request: ResetRequest = { confirmation, identity: ++identity }
      publish(confirmation.targetId, { kind: 'pending', request })
      let next: GroupResetState
      try {
        const result = resetResponse(await send(confirmation.targetId, reason.trim()))
        next = result ? { kind: 'succeeded', request, result } : { kind: 'unknown', request }
      } catch (error) {
        next = isDefiniteResetRejection(error) ? { kind: 'rejected', request, error } : { kind: 'unknown', request }
      }
      const active = getSnapshot(confirmation.targetId)
      if (active.kind === 'pending' && active.request === request) {
        // Do not expose old success/refusal as the replacement activation's result.
        // Keep a verification barrier even when the old transport did answer.
        if (!isCurrent(confirmation)) next = { kind: 'unknown', request }
        if (next.kind === 'succeeded' && confirmations.get(confirmation.targetId) === confirmation) confirmations.delete(confirmation.targetId)
        publish(confirmation.targetId, next)
      }
    },
  }
}

export const groupResets = createGroupResetController()
