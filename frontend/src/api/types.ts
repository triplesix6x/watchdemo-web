// Wire types of the FastAPI backend (web/API/views/**/schemas.py). Dates are ISO strings.

export type Role = 'user' | 'support' | 'moderator' | 'admin'
export type Tier = 'basic' | 'plus' | 'pro'
export type Channel = 'stable' | 'beta'
export type Locale = 'ru' | 'en'

/** Lowest to highest: each role can do everything the ones before it can. */
export const ROLES: readonly Role[] = ['user', 'support', 'moderator', 'admin']
export const TIERS: readonly Tier[] = ['basic', 'plus', 'pro']

/** The one role comparison: `role` is `min` or above. */
export const hasRole = (role: Role | undefined, min: Role) => !!role && ROLES.indexOf(role) >= ROLES.indexOf(min)

export interface Subscription {
  tier: Tier
  effective_tier: Tier
  expires_at: string | null
  is_expired: boolean
  started_at?: string | null
}

export interface User {
  id: string
  email: string
  username: string
  role: Role
  is_verified: boolean
  subscription: Subscription | null
  created_at: string | null
  is_beta_tester: boolean
  /** The language of the site and of the account's emails. */
  locale: Locale
}

export interface Session {
  id: string
  /** Raw User-Agent. Null or a non-browser UA means the desktop app (lib/userAgent.ts). */
  device_info: string | null
  ip_address: string | null
  expires_at: string
  last_used_at: string
  created_at: string | null
  /** The session this request came from. Sent by /users/me/sessions; the admin SessionItem omits it. */
  is_current?: boolean
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type?: string
}
export interface LoginResponse extends TokenPair {
  user: User
}
export interface MessageResponse {
  message: string
}

// Public app endpoints

/** GET /app/latest, checked against web/API/views/app/schemas.py LatestRelease. */
export interface LatestRelease {
  version: string
  channel: Channel
  url: string
  file_name: string
  file_size: number
  sha256: string
  published_at: string
  notes: string | null
}

/** GET /app/releases (ChangelogEntry). */
export interface PublicRelease {
  version: string
  channel: Channel
  published_at: string
  notes: string | null
}

/** GET /app/tiers (TiersResponse). Feature ids mirror the app's core/access.rs `Feature`. */
export type FeatureId = 'demo_import' | 'content_search' | 'replay2d' | 'advanced_stats'
export interface TierFeature {
  id: FeatureId
  allowed: boolean
  min_tier: Tier
  /** Per calendar month; null means unlimited. */
  monthly_limit: number | null
}
/** Prices are not served: the pricing page keeps them in its own config (SPEC §0). */
export interface TierInfo {
  id: Tier
  features: TierFeature[]
}

// Admin

export interface AdminUserListItem {
  id: string
  email: string
  username: string
  role: Role
  is_verified: boolean
  is_active: boolean
  is_beta_tester: boolean
  created_at: string | null
  subscription: Subscription | null
}

export interface AdminUserFilters {
  page?: number
  page_size?: number
  q?: string
  role?: Role
  verified?: boolean
  active?: boolean
  tier?: Tier | 'none'
}

export interface AdminStats {
  total: number
  verified: number
  unverified: number
  active: number
  deactivated: number
  tier_none: number
  tier_basic: number
  tier_plus: number
  tier_pro: number
  paying: number
  signups_7d: number
  signups_30d: number
}

/** GET /admin/stats/timeseries. */
export interface AdminTimeseries {
  signups: { date: string; count: number }[]
  tiers: Record<Tier | 'none', number>
  expiring_soon: { user_id: string; username: string; tier: Tier; expires_at: string }[]
}

export interface AuditItem {
  id: string
  actor_id: string
  actor_username: string | null
  action: string
  target_user_id: string | null
  target_username: string | null
  details: Record<string, unknown>
  ip_address: string | null
  created_at: string
}

export interface AdminUserDetail extends AdminUserListItem {
  sessions: Session[]
  audit: AuditItem[]
}

export interface GrantSubscriptionRequest {
  user_id?: string
  username?: string
  tier: Tier
  expires_at?: string | null
}
export interface GrantSubscriptionResponse {
  id: string
  user_id: string
  tier: Tier
  effective_tier: Tier
  started_at: string
  expires_at: string | null
  granted_by: string | null
  is_expired: boolean
}
export interface GrantRoleResponse {
  id: string
  username: string
  email: string
  role: Role
}

/** A published build of the desktop app. */
export interface AdminRelease {
  id: string
  version: string
  channel: Channel
  target: string
  arch: string
  file_name: string
  file_size: number
  sha256: string
  notes: string | null
  is_active: boolean
  show_in_changelog: boolean
  published_at: string
  published_by: string | null
  url: string
}

export interface PublishReleaseInput {
  installer: File
  version: string
  channel?: Channel
  target?: string
  arch?: string
  notes?: string
  /** The .sig content as text, or the file itself. */
  signature?: string
  signature_file?: File
}

// Support (web/API/views/support/schemas.py)

export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed'
export const TICKET_STATUSES: readonly TicketStatus[] = ['open', 'pending', 'resolved', 'closed']
export type SupportChannel = 'web' | 'telegram'

/** The customer's view: one continuous chat, no tickets, no notes. */
export interface SupportMessage {
  id: string
  /** `in`: the customer wrote it; `out`: support answered. */
  direction: 'in' | 'out'
  body: string
  /** /api/v1/support/images/{id}; needs the Bearer token, so load it with getBlob. */
  image_url: string | null
  created_at: string
}

export interface StaffMessage {
  id: string
  direction: 'in' | 'out' | 'note'
  body: string
  image_url: string | null
  author_id: string | null
  author_username: string | null
  delivery: 'sent' | 'failed' | null
  delivery_error: string | null
  edited_at: string | null
  created_at: string
}

export interface SupportTicket {
  id: string
  number: number
  status: TicketStatus
  channel: SupportChannel
  contact_name: string
  tg_username: string | null
  /** The last customer or staff message (never a note). */
  preview: string | null
  preview_direction: 'in' | 'out' | null
  preview_has_image: boolean
  unread_count: number
  /** When the customer started waiting for an answer; null once answered. */
  waiting_since: string | null
  assignee_id: string | null
  assignee_username: string | null
  last_activity_at: string
  created_at: string
}

export interface SupportTicketFilters {
  /** Omitted: every non-closed ticket. */
  status?: TicketStatus
  channel?: SupportChannel
  q?: string
  page?: number
}

export interface SupportContact {
  id: string
  channel: SupportChannel
  display_name: string
  locale: string
  /** The customer blocked the bot; replies fail until they write again. */
  blocked_at: string | null
  created_at: string
  user: { id: string; email: string; username: string; tier: Tier | null } | null
  tg_username: string | null
  tg_user_id: number | null
  other_tickets: { id: string; number: number; status: TicketStatus; created_at: string }[]
}

export interface SupportTicketDetail {
  ticket: SupportTicket
  messages: StaffMessage[]
  contact: SupportContact
  assignees: { id: string; username: string }[]
}
