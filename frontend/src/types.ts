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
