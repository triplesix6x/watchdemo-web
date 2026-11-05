import type { FeatureId, Tier, TierInfo } from '../../api/types'
import { TIERS } from '../../api/types.ts'
import { PRICES } from './prices.ts'

const FEATURES: { id: FeatureId; min: Tier }[] = [
  { id: 'demo_import', min: 'basic' }, { id: 'content_search', min: 'basic' },
  { id: 'replay2d', min: 'basic' }, { id: 'advanced_stats', min: 'basic' },
  { id: 'demo_groups', min: 'basic' }, { id: 'custom_sets', min: 'basic' },
  { id: 'voice', min: 'plus' }, { id: 'notes', min: 'plus' }, { id: 'playbooks', min: 'pro' },
]

/** Mock-only mirror of the fixed public wire contract; Windows enforcement is separate. */
export const prelaunchTiers: TierInfo[] = TIERS.map((id, rank) => ({
  id, price_rub: PRICES[id].amount, sales_open: false,
  features: FEATURES.map(({ id: feature, min }) => {
    const isMonthly = feature === 'demo_import' || feature === 'custom_sets'
    const monthly = feature === 'demo_import' ? (id === 'basic' ? 5 : id === 'plus' ? 15 : null)
      : feature === 'custom_sets' ? (id === 'basic' ? 1 : id === 'plus' ? 2 : null) : null
    const limit = feature === 'demo_groups' ? (id === 'basic' ? 2 : id === 'plus' ? 5 : null) : null
    return { id: feature, scope: 'account', min_tier: min, allowed: rank >= TIERS.indexOf(min), monthly_limit: monthly,
      limit_period: isMonthly && id !== 'pro' ? (id === 'basic' ? 'calendar_month' : 'activation_month') : null,
      limit }
  }),
}))
