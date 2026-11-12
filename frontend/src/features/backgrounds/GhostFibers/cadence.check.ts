import assert from 'node:assert/strict'
import { createAmbientCadence } from './cadence.ts'

for (const hz of [60, 90, 120, 144, 165, 240]) {
  const gate = createAmbientCadence()
  const accepted: number[] = []
  for (let i = 0; i < hz * 10; i++) {
    const now = i * 1000 / hz
    if (gate.accept(now)) accepted.push(now)
  }
  assert.ok(Math.abs(accepted.length - 600) <= 1, `${hz}Hz input should submit about 60 ambient frames per second, got ${accepted.length}`)
  // Accepted timestamps stay in wall time; skipped ticks are not simulation steps.
  const elapsed = accepted.slice(1).reduce((sum, time, i) => sum + time - accepted[i], 0)
  const final = accepted.at(-1)
  assert.ok(final !== undefined)
  assert.ok(Math.abs(elapsed - (final - accepted[0])) < 1e-7)
}

const slow = createAmbientCadence()
for (let i = 0; i < 30; i++) assert.equal(slow.accept(i * 1000 / 30), true, 'Do not further reduce a slow display')

const jitter = createAmbientCadence()
for (let i = 0; i < 120; i++) assert.equal(jitter.accept(i * 1000 / 60 + (i % 2 ? .2 : 0)), true, 'Small timestamp jitter must not halve 60Hz cadence')

const interrupted = createAmbientCadence()
assert.equal(interrupted.accept(0), true)
assert.equal(interrupted.accept(8), false)
assert.equal(interrupted.accept(5000), true, 'Resume accepts immediately, without catch-up work')
assert.equal(interrupted.accept(5001), false)
interrupted.reset()
assert.equal(interrupted.accept(5002), true, 'An explicit wake bypasses a stale deadline')
assert.equal(interrupted.accept(5003), false)

console.log('ambient cadence: ok')
