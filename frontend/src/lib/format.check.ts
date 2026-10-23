// Run: node src/lib/format.check.ts
import assert from 'node:assert/strict'
import { formatMonth, formatPrice, formatRelative, formatShortDate } from './format.ts'

const now = Date.parse('2026-10-23T12:00:00Z')
const at = (secs: number) => new Date(now + secs * 1000).toISOString()

assert.equal(formatRelative(at(-10), 'en', now), 'now')
assert.equal(formatRelative(at(-5 * 60), 'en', now), '5 minutes ago')
assert.equal(formatRelative(at(-86400), 'ru', now), 'вчера')
assert.equal(formatRelative(at(3 * 86400), 'en', now), 'in 3 days', 'the future reads forward')
assert.equal(formatRelative(at(3 * 86400), 'ru', now), 'через 3 дня')
assert.equal(formatRelative(at(-40 * 86400), 'en', now), '13 September 2026', 'past a month: the date')

assert.equal(formatShortDate('2026-10-03', 'en'), '3 Oct')
assert.match(formatMonth('2026-10-03T00:00:00Z', 'en'), /^Oct 2026$/)
assert.match(formatPrice(990, 'RUB', 'ru'), /^990\s₽$/)
console.log('format: ok')
