import type { TierFeature } from '../../api/types.ts'
import type { Dict } from '../../i18n/ru.ts'

export type FeatureDisplay = { kind: 'yes' | 'no' | 'unknown' } | { kind: 'quota'; value: string; detail: string }

/** Missing wire values are unknown, never unlimited. Only explicit null means no cap. */
export function describeTierFeature(f: Partial<TierFeature> | undefined, d: Pick<Dict, 'quota'>, count: (n: number) => string = String): FeatureDisplay {
  if (!f?.id || typeof f.allowed !== 'boolean') return { kind: 'unknown' }
  if (!f.allowed) return { kind: 'no' }
  const monthly = f.id === 'demo_import' || f.id === 'custom_sets'
  if (!monthly && f.id !== 'demo_groups') return { kind: 'yes' }
  // A legacy quantity cap cannot describe a monthly creation allowance.
  const limit = monthly ? (f.limit != null ? undefined : f.monthly_limit) : f.limit
  const value = limit === null ? d.quota.unlimited
    : typeof limit === 'number' && Number.isFinite(limit) && limit >= 0 ? count(limit) : d.quota.unknown
  const period = !monthly ? d.quota.simultaneous
    : f.limit_period === 'calendar_month' ? d.quota.calendarMonth
    : f.limit_period === 'activation_month' ? d.quota.activationMonth
    : limit === null && f.limit_period === null ? d.quota.monthly : d.quota.periodUnknown
  const scope = f.scope === 'account' ? d.quota.account : d.quota.scopeUnknown
  return { kind: 'quota', value, detail: `${period} · ${scope}` }
}
