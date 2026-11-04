// node src/features/home/anchors.check.ts
import assert from 'node:assert/strict'
import { scrollFor, timeAt, type Anchor } from './anchors.ts'

const A: Anchor[] = [
  { y: 0, t: 26 },
  { y: 1000, t: 30.8 },
  { y: 2000, t: 45.7 },
  { y: 3000, t: 75 },
]
assert.equal(timeAt(A, -50), 26, 'above the story the hero frame holds')
assert.equal(timeAt(A, 500), 28.4, 'halfway between anchors is halfway in time')
assert.equal(timeAt(A, 9999), 75, 'past the story the round has ended')
assert.equal(timeAt(A, 1500, true), 30.8, 'reduced motion holds the chapter frame')
for (const y of [0, 250, 1000, 1999, 2600, 3000]) assert.ok(Math.abs(scrollFor(A, timeAt(A, y)) - y) < 1e-9, `round trip at ${y}`)
assert.equal(scrollFor(A, 10), 0, 'times before the hero map to the top')
console.log('anchors: ok')
