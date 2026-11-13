import { api } from '../../api/client'
import type { Locale } from '../../i18n'

export type SocialProvider = 'steam' | 'faceit'
export type SocialIntent = 'login' | 'link' | 'reauth'
export type SocialStatus = { stage: 'pending_registration' | 'login_ready' | 'linked' | 'reauth_ready'; provider: SocialProvider; destination: 'desktop' | 'website'; flow_id: string }
export type Connections = Record<SocialProvider, { available: boolean; linked: boolean }>
export const socialApi = {
  providers: () => api.get<Record<SocialProvider, boolean>>('/auth/social/providers'),
  connections: () => api.get<Connections>('/auth/social/connections'),
  start: (provider: SocialProvider, intent: SocialIntent) => api.post<{ authorization_url: string }>(
    `/auth/social/${provider}/${intent === 'login' ? 'start' : 'connect'}`, { intent }),
  status: () => api.get<SocialStatus>('/auth/social/status'),
  register: (username: string, locale: Locale, flow_id: string) => api.post('/auth/social/register', { username, locale, flow_id }),
  approveDesktop: (flow_id: string) => api.post('/auth/social/desktop/approve', { flow_id }),
  finish: (flow_id: string) => api.post('/auth/social/finish', { flow_id }),
  email: (new_email: string) => api.post('/auth/social/email', { new_email }),
  password: (new_password: string, sign_out_others: boolean) => api.post('/auth/social/password', { new_password, sign_out_others }),
  deleteAccount: (username: string) => api.delete('/auth/social/account', { username }),
}

/** Missing flag means a pre-social API/mock, not a passwordless account. */
export const hasPassword = (user: { id: string; has_password?: boolean } | null) => user?.has_password !== false
