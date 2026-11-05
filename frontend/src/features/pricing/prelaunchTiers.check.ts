// Run by the coordinator only: node src/features/pricing/prelaunchTiers.check.ts
import assert from 'node:assert/strict'
import { prelaunchTiers } from './prelaunchTiers.ts'
import type { FeatureId, Tier } from '../../api/types.ts'

assert.deepEqual(prelaunchTiers.map(({ id, price_rub, sales_open }) => [id, price_rub, sales_open]), [['basic', 0, false], ['plus', 349, false], ['pro', 469, false]])
function feature(tier: Tier, id: FeatureId) {
  const row = prelaunchTiers.find((t) => t.id === tier)?.features.find((f) => f.id === id)
  assert.ok(row, `${tier}/${id} exists`)
  return row
}
for (const [tier, monthly, period, groups, sets] of [['basic', 5, 'calendar_month', 2, 1], ['plus', 15, 'activation_month', 5, 2], ['pro', null, null, null, null]] as const) {
  assert.equal(feature(tier, 'demo_import').monthly_limit, monthly)
  assert.equal(feature(tier, 'demo_import').limit_period, period)
  assert.equal(feature(tier, 'demo_import').limit, null)
  assert.equal(feature(tier, 'demo_groups').limit, groups)
  assert.equal(feature(tier, 'custom_sets').monthly_limit, sets)
  assert.equal(feature(tier, 'custom_sets').limit_period, period)
  assert.equal(feature(tier, 'custom_sets').limit, null, 'set creations are monthly, not a stored quantity cap')
  for (const id of ['content_search', 'replay2d', 'advanced_stats'] as const) assert.equal(feature(tier, id).allowed, true)
  for (const id of ['voice', 'notes'] as const) assert.equal(feature(tier, id).allowed, tier !== 'basic')
  assert.equal(feature(tier, 'playbooks').allowed, tier === 'pro')
  for (const f of prelaunchTiers.find((t) => t.id === tier)!.features) {
    assert.equal(f.scope, 'account', `${tier}/${f.id} is account-global`)
    if (f.id !== 'demo_import' && f.id !== 'custom_sets') {
      assert.equal(f.monthly_limit, null)
      assert.equal(f.limit_period, null)
    }
  }
}
assert.equal(feature('pro', 'playbooks').limit, null)
console.log('prelaunchTiers: fixed prices/sales closed/account scope/monthly imports and creations/simultaneous groups: ok')
