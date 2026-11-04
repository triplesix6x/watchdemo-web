// node src/features/home/anchors.check.ts
import assert from 'node:assert/strict'
import { episodeAnchors, scrollFor, timeAt, type Anchor } from './anchors.ts'

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
// A hero and launch explanation now precede the episode. The full 0..75 range
// must remain reachable, including reverse seeking, independently of that offset.
const episode = episodeAnchors(2400, [
  { y: 2800, t: 30.8 },
  { y: 3400, t: 43 },
  { y: 4000, t: 45.7 },
  { y: 4600, t: 71 },
], 5200, 75)
assert.equal(timeAt(episode, 0), 0, 'above the episode hold the real start')
assert.equal(scrollFor(episode, 0), 2400, 'Home seeks to the episode, not the hero')
assert.equal(scrollFor(episode, 75), 5200, 'End reaches the round duration')
assert.equal(timeAt(episode, 9999), 75)
for (const t of [75, 74, 71, 45.7, 43, 30.8, 20, 2, 0]) {
  assert.ok(Math.abs(timeAt(episode, scrollFor(episode, t)) - t) < 1e-9, `reverse round trip at ${t}`)
}
const compressed = episodeAnchors(-100, [{ y: -20, t: 30 }, { y: -40, t: 60 }], -50, 75)
assert.deepEqual(compressed.map((a) => a.y), [0, 1, 2, 3], 'small viewports retain strictly increasing scroll anchors')
console.log('anchors: ok')
