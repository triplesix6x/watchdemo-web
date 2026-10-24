// One typed function per backend endpoint. Paths are relative to /api/v1.
import { api, uploadForm } from './client'
import type {
  AdminRelease,
  AdminStats,
  AdminTimeseries,
  AdminUserDetail,
  AdminUserFilters,
  AdminUserListItem,
  AuditItem,
  CrashFilters,
  CrashGroup,
  CrashGroupDetail,
  CrashGroupUpdate,
  CrashReportDetail,
  Channel,
  GrantRoleResponse,
  GrantSubscriptionRequest,
  GrantSubscriptionResponse,
  LatestRelease,
  Locale,
  LoginResponse,
  MessageResponse,
  Paginated,
  PublicRelease,
  PublishReleaseInput,
  Role,
  Session,
  StaffMessage,
  SupportMessage,
  SupportTicket,
  SupportTicketDetail,
  SupportTicketFilters,
  TicketStatus,
  TierInfo,
  User,
} from './types'

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
  const out = s.toString()
  return out ? `?${out}` : ''
}

export const authApi = {
  login: (login: string, password: string) => api.post<LoginResponse>('/auth/login', { login, password }),
  /** `locale`: the language of the account's emails. 409 when the email or username is taken. */
  register: (body: { email: string; username: string; password: string; locale?: Locale }) =>
    api.post<MessageResponse>('/auth/register', body),
  logout: () => api.post<void>('/auth/logout'),
  verifyEmail: (token: string) => api.get<MessageResponse>(`/auth/verify-email${qs({ token })}`),
  /** 401 for a spent or expired link, 409 when the address was taken meanwhile. */
  confirmEmailChange: (token: string) => api.get<MessageResponse>(`/auth/confirm-email-change${qs({ token })}`),
  forgotPassword: (email: string) => api.post<MessageResponse>('/auth/forgot-password', { email }),
  resetPassword: (token: string, new_password: string) =>
    api.post<MessageResponse>('/auth/reset-password', { token, new_password }),
  resendVerification: (email: string) => api.post<MessageResponse>('/auth/resend-verification', { email }),
}

export const meApi = {
  get: () => api.get<User>('/users/me'),
  /** Username keeps the register rules (422); 409 when taken. */
  update: (body: { username?: string; locale?: Locale }) => api.patch<User>('/users/me', body),
  /** 204; the server emails a "password changed" notice. Wrong current password: 403
   *  "Invalid password" (403, not 401, so the client does not refresh and retry). */
  changePassword: (body: { current_password: string; new_password: string; sign_out_others: boolean }) =>
    api.post<void>('/users/me/password', body),
  /** 202; a confirm link goes to the new address. 403 wrong password, 409 address taken,
   *  422 "New email matches the current one". */
  changeEmail: (body: { new_email: string; password: string }) => api.post<MessageResponse>('/users/me/email', body),
  /** 204. 403 wrong password, 422 "Username does not match". */
  deleteAccount: (body: { password: string; username: string }) => api.delete<void>('/users/me', body),
  sessions: () => api.get<Session[]>('/users/me/sessions'),
  revokeSession: (id: string) => api.delete<void>(`/users/me/sessions/${id}`),
  /** Signs out every session except the current one. */
  revokeOtherSessions: () => api.delete<void>('/users/me/sessions'),
}

export const appApi = {
  /** Windows x86_64. Optional auth: beta testers get the beta channel. 404 when nothing is
   *  published. Pages read it through lib/useLatestRelease. */
  latest: () => api.get<LatestRelease>(`/app/latest${qs({ target: 'windows', arch: 'x86_64' })}`),
  /** Changelog: active releases with show_in_changelog, newest first. */
  releases: (opts: { channel?: Channel; limit?: number } = {}) =>
    api.get<PublicRelease[]>(`/app/releases${qs({ channel: opts.channel ?? 'stable', limit: opts.limit ?? 20 })}`),
  /** Feature matrix per tier, mirrors the app's core/access.rs. */
  tiers: () => api.get<{ tiers: TierInfo[] }>('/app/tiers').then((r) => r.tiers),
}

export const adminApi = {
  stats: () => api.get<AdminStats>('/admin/stats'),
  timeseries: (days: 30 | 90) => api.get<AdminTimeseries>(`/admin/stats/timeseries${qs({ days })}`),
  users: (f: AdminUserFilters = {}) => api.get<Paginated<AdminUserListItem>>(`/admin/users${qs({ ...f })}`),
  user: (id: string) => api.get<AdminUserDetail>(`/admin/users/${id}`),
  setActive: (id: string, is_active: boolean) => api.patch<AdminUserListItem>(`/admin/users/${id}/active`, { is_active }),
  setBeta: (id: string, is_beta_tester: boolean) =>
    api.patch<AdminUserListItem>(`/admin/users/${id}/beta`, { is_beta_tester }),
  setRole: (user_id: string, role: Role) => api.post<GrantRoleResponse>('/admin/users/role', { user_id, role }),
  grantSubscription: (body: GrantSubscriptionRequest) =>
    api.post<GrantSubscriptionResponse>('/admin/subscriptions/grant', body),
  /** Moderator+. */
  extendSubscription: (user_id: string, days: number) =>
    api.post<GrantSubscriptionResponse>('/admin/subscriptions/extend', { user_id, days }),
  /** Moderator+. */
  revokeSubscription: (user_id: string) =>
    api.post<GrantSubscriptionResponse>('/admin/subscriptions/revoke', { user_id }),
  /** Signs the user out everywhere. */
  revokeSessions: (id: string) => api.delete<void>(`/admin/users/${id}/sessions`),
  /** Emails a reset link. */
  sendPasswordReset: (id: string) => api.post<MessageResponse>(`/admin/users/${id}/password-reset`),
  /** Moderator+. */
  verify: (id: string) => api.post<AdminUserListItem>(`/admin/users/${id}/verify`),
  audit: (page = 1, page_size = 25) => api.get<Paginated<AuditItem>>(`/admin/audit${qs({ page, page_size })}`),
  releases: (opts: { page?: number; page_size?: number; channel?: Channel } = {}) =>
    api.get<Paginated<AdminRelease>>(`/admin/releases${qs({ ...opts })}`),
  /** Multipart upload with progress (0-100). */
  publishRelease: (input: PublishReleaseInput, onProgress?: (percent: number) => void) => {
    const form = new FormData()
    form.append('installer', input.installer)
    form.append('version', input.version)
    form.append('channel', input.channel ?? 'stable')
    form.append('target', input.target ?? 'windows')
    form.append('arch', input.arch ?? 'x86_64')
    if (input.notes) form.append('notes', input.notes)
    if (input.signature) form.append('signature', input.signature)
    if (input.signature_file) form.append('signature_file', input.signature_file)
    return uploadForm<AdminRelease>('/admin/releases', form, onProgress)
  },
  setReleaseActive: (id: string, is_active: boolean) =>
    api.patch<AdminRelease>(`/admin/releases/${id}/active`, { is_active }),
  /** Admin. `notes: null` clears the notes; an omitted field stays as is. */
  updateRelease: (id: string, body: { notes?: string | null; show_in_changelog?: boolean }) =>
    api.patch<AdminRelease>(`/admin/releases/${id}`, body),
}

/** Admin only. */
export const crashApi = {
  groups: (f: CrashFilters = {}) => api.get<Paginated<CrashGroup>>(`/admin/crashes${qs({ ...f })}`),
  group: (id: string) => api.get<CrashGroupDetail>(`/admin/crashes/${id}`),
  report: (id: string) => api.get<CrashReportDetail>(`/admin/crashes/reports/${id}`),
  /** An omitted field stays as is; `null` clears notes or the version. A status change is audited. */
  update: (id: string, body: CrashGroupUpdate) => api.patch<CrashGroup>(`/admin/crashes/${id}`, body),
}

const messageForm = (body: string, image?: File | null, note?: boolean) => {
  const form = new FormData()
  form.append('body', body)
  if (note) form.append('note', 'true')
  if (image) form.append('image', image)
  return form
}

/** The signed-in customer's support chat. */
export const supportApi = {
  /** Oldest first. With `after`, the newer ones; it may repeat a few recent ones, so merge by id. */
  messages: (after?: string) => api.get<SupportMessage[]>(`/support/messages${qs({ after })}`),
  /** `body` up to 4000 chars, may be empty with an image (png, jpeg or webp, up to 10 MB). */
  send: (body: string, image?: File | null) => uploadForm<SupportMessage>('/support/messages', messageForm(body, image)),
}

/** The support inbox, support role and up. */
export const supportAdminApi = {
  tickets: (f: SupportTicketFilters = {}) => api.get<Paginated<SupportTicket>>(`/admin/support/tickets${qs({ ...f })}`),
  ticket: (id: string) => api.get<SupportTicketDetail>(`/admin/support/tickets/${id}`),
  /** A reply goes to the customer and sets the ticket pending; a note stays internal. */
  post: (id: string, body: string, opts: { note?: boolean; image?: File | null } = {}) =>
    uploadForm<StaffMessage>(`/admin/support/tickets/${id}/messages`, messageForm(body, opts.image, opts.note)),
  /** `assignee_id: null` unassigns; an omitted field stays as it is. */
  update: (id: string, body: { status?: TicketStatus; assignee_id?: string | null }) =>
    api.patch<SupportTicket>(`/admin/support/tickets/${id}`, body),
  read: (id: string) => api.post<void>(`/admin/support/tickets/${id}/read`),
  unread: () => api.get<{ tickets: number }>('/admin/support/unread'),
}
