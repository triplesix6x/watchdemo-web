import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { VARIANTS, diagnosticTransform, frameSummary, orderSamples, offscreenStatus } from './home-scroll-diagnostic-contract.mjs'

const modules = ['src/features/backgrounds/HomeBackground.tsx', 'src/features/backgrounds/home-background.css', 'src/features/radar/driver.ts']
for (const variant of VARIANTS) {
  test(`isolated ${variant} transform touches one module, normal touches none`, async () => {
    const plugin = diagnosticTransform(variant)
    let changed = 0
    for (const file of modules) {
      const source = await fs.readFile(new URL('../' + file, import.meta.url), 'utf8')
      const result = plugin.transform(source, '/fixture/' + file)
      if (result) { changed++; assert.notEqual(result.code, source) }
    }
    plugin.buildEnd()
    assert.equal(changed, variant === 'normal' ? 0 : 1)
  })
}
test('transforms fail closed on changed source anchors', () => {
  assert.throws(() => diagnosticTransform('blur-off').transform('changed CSS', '/features/backgrounds/home-background.css'), /anchor/)
  assert.throws(() => diagnosticTransform('radar-off').buildEnd(), /exactly one/)
  assert.throws(() => diagnosticTransform('unknown'), /Unknown variant/)
})
test('desktop document boundary is unavailable evidence, not a fake offscreen pass', () => {
  assert.equal(offscreenStatus({ width: 1280, scrollY: 5512, maximum: 5512, stage: { visible: true } }), 'unavailable-at-document-end')
  assert.equal(offscreenStatus({ width: 390, scrollY: 5000, maximum: 5000, stage: { visible: false } }), 'observed')
  assert.throws(() => offscreenStatus({ width: 390, scrollY: 5000, maximum: 5000, stage: { visible: true } }), /did not move radar offscreen/)
  assert.throws(() => offscreenStatus({ width: 1280, scrollY: 4000, maximum: 5512, stage: { visible: true } }), /did not move radar offscreen/)
  assert.throws(() => offscreenStatus({ width: 1280, scrollY: 5512, maximum: 5512, stage: null }), /stage missing/)
})
test('frame tails retain worst case and threshold counts', () => {
  assert.deepEqual(frameSummary([16, 20, 100, 40]), { count: 4, p50: 20, p95: 40, p99: 40, worst: 100, over33ms: 2, over50ms: 1 })
  assert.equal(frameSummary([]).p95, null)
})
test('serial order rotates and preserves every sample', () => {
  const entries = [{ variant: 'a' }, { variant: 'b' }, { variant: 'c' }]
  assert.deepEqual(orderSamples(2, entries).map(e => e.variant), ['a', 'b', 'c', 'b', 'c', 'a'])
  assert.throws(() => orderSamples(0, entries), /1..6/)
})
