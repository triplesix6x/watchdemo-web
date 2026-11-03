// Published reference prices, not a checkout offer. Sales remain closed.
import type { Tier } from '../../api/types'
export type Price = { amount: number; currency: 'RUB' }
export const PRICES: Record<Tier, Price> = {
  basic: { amount: 0, currency: 'RUB' },
  plus: { amount: 349, currency: 'RUB' },
  pro: { amount: 469, currency: 'RUB' },
}
export const RECOMMENDED: Tier = 'plus'
