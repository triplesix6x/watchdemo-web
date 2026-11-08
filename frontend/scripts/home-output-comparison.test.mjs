import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { WORKLOAD, sampleOrder, hardwareGPU, summarize, warmHomepageImages } from './home-output-comparison-contract.mjs'

test('whole-home comparison uses repeated unchanged baselines and rotated candidate order', () => {
  assert.deepEqual(sampleOrder(3).map(s => s.source), ['baseline', 'baseline', 'candidate', 'baseline', 'candidate', 'baseline', 'candidate', 'baseline', 'baseline'])
  assert.equal(sampleOrder(6).length, 18)
  for (const invalid of [undefined, NaN, 0, 2, 7, 3.5, '3']) assert.throws(() => sampleOrder(invalid))
  assert.deepEqual(WORKLOAD.phases, ['idle', 'scroll-down', 'offscreen-idle', 'scroll-reentry'])
  assert.equal(WORKLOAD.phaseMs, 2000)
})
test('lazy-image preconditioning traverses normal viewport positions and returns to the hero', async () => {
  for (const [height, expected] of [[2500, [0, 800, 1600, 1700, 0]], [600, [0, 0]]]) {
    const calls = [], frames = []
    await vm.runInNewContext(`(${warmHomepageImages.toString()})()`, {
      document: { documentElement: { scrollHeight: height } }, innerHeight: 800,
      window: { scrollTo: options => calls.push(options) },
      requestAnimationFrame: resolve => { frames.push(calls.length); resolve(0) },
    })
    assert.deepEqual(calls.map(call => call.top), expected)
    assert.ok(calls.every(call => call.behavior === 'instant'))
    assert.equal(frames.length, calls.length)
  }
})
test('unidentified and software GPU counterfactuals never become performance evidence', () => {
  for (const gpu of [null, {}, { renderer: 'ANGLE' }, ...['SwiftShader', 'llvmpipe', 'Microsoft Basic Render Driver', 'WARP'].map(unmaskedRenderer => ({ renderer: 'ANGLE', unmaskedRenderer }))]) assert.throws(() => hardwareGPU(gpu))
  assert.deepEqual(hardwareGPU({ renderer: 'ANGLE', unmaskedRenderer: 'AMD Radeon RX 5700 XT Direct3D11' }), { renderer: 'ANGLE', unmaskedRenderer: 'AMD Radeon RX 5700 XT Direct3D11' })
})
test('raw repeat noise and even a faster candidate remain explicitly nonaccepting', () => {
  const samples = sampleOrder(3).map((entry, index) => ({ ...entry, metrics: Object.fromEntries(['p50FrameMs', 'p95FrameMs', 'longFrames', 'taskDurationMs', 'scriptDurationMs', 'layoutDurationMs'].map(key => [key, entry.source === 'baseline' ? 20 + index : 1])) }))
  const summary = summarize(samples)
  assert.equal(summary.accepting, false)
  assert.match(summary.conclusion, /no proven speedup or visual equivalence/)
  assert.equal(summary.metrics.p50FrameMs.baseline.length, 6)
  assert.equal(summary.metrics.p50FrameMs.candidate.length, 3)
  assert.ok(summary.metrics.p50FrameMs.baselineRange > 0)
  assert.ok(summary.metrics.p50FrameMs.medianDelta < 0)
  assert.throws(() => summarize(samples.slice(1)), /Incomplete/)
  samples[0].metrics.taskDurationMs = NaN
  assert.throws(() => summarize(samples), /finite metric/)
})
