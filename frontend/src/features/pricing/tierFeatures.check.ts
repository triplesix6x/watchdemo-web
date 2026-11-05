// Run by the coordinator only: node src/features/pricing/tierFeatures.check.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { prelaunchTiers } from './prelaunchTiers.ts'
import { describeTierFeature } from './tierFeatures.ts'
import { ru } from '../../i18n/ru.ts'
import { en } from '../../i18n/en.ts'
import pricingRu from '../../i18n/pages/pricing.ru.ts'
import pricingEn from '../../i18n/pages/pricing.en.ts'
import helpRu from '../../i18n/pages/help.ru.ts'
import helpEn from '../../i18n/pages/help.en.ts'

for (const d of [ru, en]) {
  for (const tier of prelaunchTiers) {
    for (const id of ['demo_import', 'custom_sets', 'demo_groups'] as const) {
      const f = tier.features.find((row) => row.id === id)
      assert.ok(f)
      const period = id === 'demo_groups' ? d.quota.simultaneous
        : tier.id === 'basic' ? d.quota.calendarMonth : tier.id === 'plus' ? d.quota.activationMonth : d.quota.monthly
      const limit = id === 'demo_groups' ? f.limit : f.monthly_limit
      assert.deepEqual(describeTierFeature(f, d), {
        kind: 'quota', value: limit === null ? d.quota.unlimited : String(limit), detail: `${period} · ${d.quota.account}`,
      })
    }
  }
  assert.deepEqual(describeTierFeature(undefined, d), { kind: 'unknown' })
  assert.deepEqual(describeTierFeature({ id: 'custom_sets' }, d), { kind: 'unknown' })
  assert.deepEqual(describeTierFeature({ allowed: true }, d), { kind: 'unknown' })
  assert.deepEqual(describeTierFeature({ id: 'voice', allowed: false }, d), { kind: 'no' })
  assert.deepEqual(describeTierFeature({ id: 'voice', allowed: true }, d), { kind: 'yes' })
  const monthly = { id: 'custom_sets', allowed: true, scope: 'account', limit_period: 'calendar_month' } as const
  for (const monthly_limit of [undefined, -1, NaN, Infinity]) {
    assert.deepEqual(describeTierFeature({ ...monthly, monthly_limit }, d), {
      kind: 'quota', value: d.quota.unknown, detail: `${d.quota.calendarMonth} · ${d.quota.account}`,
    })
  }
  assert.deepEqual(describeTierFeature({ ...monthly, monthly_limit: 0 }, d), {
    kind: 'quota', value: '0', detail: `${d.quota.calendarMonth} · ${d.quota.account}`,
  }, 'zero is not unlimited')
  assert.deepEqual(describeTierFeature({ id: 'demo_import', allowed: true, monthly_limit: 5 }, d), {
    kind: 'quota', value: '5', detail: `${d.quota.periodUnknown} · ${d.quota.scopeUnknown}`,
  })
  assert.deepEqual(describeTierFeature({ id: 'custom_sets', allowed: true, monthly_limit: null, limit: 1 }, d), {
    kind: 'quota', value: d.quota.unknown, detail: `${d.quota.periodUnknown} · ${d.quota.scopeUnknown}`,
  }, 'legacy quantity limits cannot imply unlimited monthly creations')
  assert.deepEqual(describeTierFeature({ id: 'demo_groups', allowed: true, limit: null, scope: 'account' }, d), {
    kind: 'quota', value: d.quota.unlimited, detail: `${d.quota.simultaneous} · ${d.quota.account}`,
  })
  assert.deepEqual(describeTierFeature({ id: 'demo_groups', allowed: true, scope: 'account' }, d), {
    kind: 'quota', value: d.quota.unknown, detail: `${d.quota.simultaneous} · ${d.quota.account}`,
  })
}

assert.match(pricingRu.hints.demo_import, /5 за календарный месяц UTC.*15 за месяц от исходной платной активации/)
assert.match(pricingEn.hints.demo_import, /5 per UTC calendar month.*15 per month from original paid activation/)
assert.match(pricingRu.hints.custom_sets, /Создания за месяц на весь аккаунт: 1 \/ 2 \/ без лимита/)
assert.match(pricingEn.hints.custom_sets, /Monthly account-wide creations: 1 \/ 2 \/ unlimited/)
assert.match(pricingRu.hints.demo_groups, /Одновременно на весь аккаунт во всех библиотеках: 2 \/ 5 \/ без лимита/)
assert.match(pricingEn.hints.demo_groups, /Simultaneously across all account libraries: 2 \/ 5 \/ unlimited/)
assert.match(ru.quota.note, /существующие наборы не расходуют квоту следующего месяца/i)
assert.match(en.quota.note, /existing sets do not consume next month’s quota/i)
assert.match(ru.quota.note, /удаление её не возвращает/)
assert.match(en.quota.note, /deleting them does not refund quota/)
const helpImportRu = helpRu.sections.flatMap((section) => section.items).find((item) => item.id === 'import-how')?.a ?? ''
const helpImportEn = helpEn.sections.flatMap((section) => section.items).find((item) => item.id === 'import-how')?.a ?? ''
assert.match(helpImportRu, /5 импортов и 1 создание своего набора за календарный месяц UTC, 2 группы одновременно/)
assert.match(helpImportRu, /15 импортов и 2 создания наборов за месяц от исходной платной активации, 5 групп одновременно/)
assert.match(helpImportEn, /5 imports and 1 custom set creation per UTC calendar month, 2 groups simultaneously/)
assert.match(helpImportEn, /15 imports and 2 set creations per month from original paid activation, 5 groups simultaneously/)
for (const help of [helpRu, helpEn]) {
  const answer = help.sections.flatMap((section) => section.items).find((item) => item.id === 'plans-quotas')?.a
  assert.ok(answer)
  assert.ok(answer.includes('\n\n'), 'help quota explanation has real paragraph breaks')
  assert.ok(!answer.includes('\\n'), 'no escaped newline text is shown')
}
// The table, phone cards and account share the same quota formatter instead of inferring unlimited independently.
const pricing = fs.readFileSync(new URL('../../pages/Pricing.tsx', import.meta.url), 'utf8')
const overview = fs.readFileSync(new URL('../../pages/account/Overview.tsx', import.meta.url), 'utf8')
assert.match(pricing, /describeTierFeature\(/)
assert.match(overview, /describeTierFeature\(/)
assert.match(pricing, /<CellView cell=\{row.cells\[tier\]\}/)
assert.match(pricing, /t\.quota\.note/)
assert.match(overview, /t\.quota\.note/)
console.log('tierFeatures: monthly account scope, simultaneous groups, unknown vs unlimited, RU/EN quota copy: ok')
