// Who may do what in the admin panel. Mirrors web/API/views/admin/views.py (the minimum
// role per endpoint) and web/APP/services/admin_service.py (the rules about the target).
// The UI hides what the backend would refuse; a 403 that still happens is shown as is.
import { hasRole, type Role } from '../../api/types.ts'

export type UserAction =
  | 'setActive'
  | 'revokeSessions'
  | 'passwordReset'
  | 'beta'
  | 'verify'
  | 'subscription'
  | 'role'

/** strict: get_modifiable_target (not yourself; a lower role, or an equal one for admins).
 *  notHigher: the target's role is not above the actor's (beta, verify).
 *  others: anyone but yourself (UI rule: an admin never demotes themselves by accident).
 *  any: no target check on the server. */
type TargetRule = 'strict' | 'notHigher' | 'others' | 'any'

const USER_ACTIONS: Record<UserAction, { min: Role; target: TargetRule }> = {
  setActive: { min: 'moderator', target: 'strict' },
  revokeSessions: { min: 'moderator', target: 'strict' },
  passwordReset: { min: 'moderator', target: 'strict' },
  beta: { min: 'moderator', target: 'notHigher' },
  verify: { min: 'moderator', target: 'notHigher' },
  subscription: { min: 'moderator', target: 'any' },
  role: { min: 'admin', target: 'others' },
}

/** Sections and page-level abilities, by minimum role. */
const SECTIONS = {
  moderate: 'moderator',
  viewReleases: 'moderator',
  manageReleases: 'admin',
  viewAudit: 'admin',
} as const satisfies Record<string, Role>

type Person = { id: string; role: Role }

export const can = (role: Role | undefined, what: keyof typeof SECTIONS) => hasRole(role, SECTIONS[what])

export function canOnUser(actor: Person | null | undefined, target: Person, action: UserAction): boolean {
  if (!actor) return false
  const rule = USER_ACTIONS[action]
  if (!hasRole(actor.role, rule.min)) return false
  const self = actor.id === target.id
  switch (rule.target) {
    case 'any':
      return true
    case 'others':
      return !self
    case 'notHigher':
      return hasRole(actor.role, target.role)
    case 'strict':
      return !self && (target.role === actor.role ? actor.role === 'admin' : hasRole(actor.role, target.role))
  }
}
