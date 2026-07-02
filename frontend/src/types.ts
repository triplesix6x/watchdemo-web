export interface Subscription {
  tier: string
  effective_tier: string
  expires_at: string | null
  is_expired: boolean
}

export interface User {
  id: string
  email: string
  username: string
  role: string
  is_verified: boolean
  subscription: Subscription | null
}

export interface Session {
  id: string
  device_info: string | null
  ip_address: string | null
  expires_at: string
  last_used_at: string
  created_at: string
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface AdminUserListItem {
  id: string
  email: string
  username: string
  role: string
  is_verified: boolean
  is_active: boolean
  created_at: string | null
  subscription: Subscription | null
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

export interface AdminUserDetail {
  id: string
  email: string
  username: string
  role: string
  is_verified: boolean
  is_active: boolean
  created_at: string | null
  subscription: Subscription | null
  sessions: Session[]
  audit: AuditItem[]
}
