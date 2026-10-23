// Prices per tier. The backend does not serve them: there is no payment yet and the
// numbers are not decided (SPEC §0). A tier with `placeholder: true` shows «Цена
// уточняется»; set `amount` and drop the flag when a price is final.
import type { Tier } from '../../api/types'

export type Price = { amount: number | null; currency: 'RUB'; placeholder: boolean }

export const PRICES: Record<Tier, Price> = {
  basic: { amount: 0, currency: 'RUB', placeholder: false },
  plus: { amount: null, currency: 'RUB', placeholder: true },
  pro: { amount: null, currency: 'RUB', placeholder: true },
}

export const RECOMMENDED: Tier = 'plus'
