import { api } from '../../api/client'
import { parsePublicNotice, parseSettings, type MaintenanceSettings, type PublicNotice } from './contract'

export const NOTICE_CHANGED = 'watchdemo:maintenance-notice-changed'

export const maintenanceApi = {
  publicNotice: async (locale: 'ru' | 'en'): Promise<PublicNotice> =>
    parsePublicNotice(await api.get<unknown>(`/maintenance-notice?locale=${locale}`)),
  settings: async (): Promise<MaintenanceSettings> =>
    parseSettings(await api.get<unknown>('/admin/maintenance-notice')),
  save: async (settings: MaintenanceSettings): Promise<MaintenanceSettings> => {
    const saved = parseSettings(await api.patch<unknown>('/admin/maintenance-notice', settings))
    window.dispatchEvent(new Event(NOTICE_CHANGED))
    return saved
  },
}
