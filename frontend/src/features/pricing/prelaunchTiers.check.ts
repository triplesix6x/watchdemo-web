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
  assert.equal(feature(tier, 'demo_groups').limit, groups)
  assert.equal(feature(tier, 'custom_sets').limit, sets)
  for (const id of ['content_search', 'replay2d', 'advanced_stats'] as const) assert.equal(feature(tier, id).allowed, true)
  for (const id of ['voice', 'notes'] as const) assert.equal(feature(tier, id).allowed, tier !== 'basic')
  assert.equal(feature(tier, 'playbooks').allowed, tier === 'pro')
  for (const f of prelaunchTiers.find((t) => t.id === tier)!.features) {
    if (f.id !== 'demo_import') assert.equal(f.monthly_limit, null)
    if (f.id !== 'demo_import') assert.equal(f.limit_period, null)
  }
}
assert.equal(feature('pro', 'playbooks').limit, null)
console.log('prelaunchTiers: fixed ids/prices/sales closed/periods/limits/features: ok')
