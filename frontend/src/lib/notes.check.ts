// Run: node src/lib/notes.check.ts
import assert from 'node:assert/strict'
import { notesToPlain, parseInline, parseNotes, versionAnchor } from './notes.ts'

assert.deepEqual(parseNotes('- one\n- two **bold**'), [
  { t: 'ul', items: [[{ t: 'text', v: 'one' }], [{ t: 'text', v: 'two ' }, { t: 'strong', v: 'bold' }]] },
])
assert.deepEqual(parseNotes('first line\nsame paragraph\n\nsecond'), [
  { t: 'p', v: [{ t: 'text', v: 'first line same paragraph' }] },
  { t: 'p', v: [{ t: 'text', v: 'second' }] },
])
assert.deepEqual(parseNotes('## Fixes\n1. a\n2. b\n- c'), [
  { t: 'h', v: [{ t: 'text', v: 'Fixes' }] },
  { t: 'ol', items: [[{ t: 'text', v: 'a' }], [{ t: 'text', v: 'b' }]] },
  { t: 'ul', items: [[{ t: 'text', v: 'c' }]] },
])
assert.deepEqual(parseNotes('- item\n  continues\ntext after'), [
  { t: 'ul', items: [[{ t: 'text', v: 'item continues' }]] },
  { t: 'p', v: [{ t: 'text', v: 'text after' }] },
])
assert.deepEqual(parseNotes('a\r\n\r\n\r\nb').length, 2, 'CRLF and repeated blank lines')

assert.deepEqual(parseInline('run `Get-FileHash` now'), [
  { t: 'text', v: 'run ' },
  { t: 'code', v: 'Get-FileHash' },
  { t: 'text', v: ' now' },
])
assert.deepEqual(parseInline('[site](/download) and [tg](https://t.me/x)'), [
  { t: 'link', v: 'site', href: '/download' },
  { t: 'text', v: ' and ' },
  { t: 'link', v: 'tg', href: 'https://t.me/x' },
])
assert.deepEqual(parseInline('[x](javascript:alert(1))'), [{ t: 'text', v: '[x](javascript:alert(1)' }, { t: 'text', v: ')' }], 'unsafe scheme stays text')
assert.deepEqual(parseInline('[x](//evil.example)'), [{ t: 'text', v: '[x](//evil.example)' }], 'protocol-relative link stays text')
assert.deepEqual(parseInline('[x](/\\evil.example)'), [{ t: 'text', v: '[x](/\\evil.example)' }], 'backslash link stays text')
assert.deepEqual(parseInline('[x](https:\\\\evil.example)'), [{ t: 'text', v: '[x](https:\\\\evil.example)' }], 'backslash scheme link stays text')
assert.deepEqual(parseInline('[x](/%5Cevil.example)'), [{ t: 'link', v: 'x', href: '/%5Cevil.example' }], 'an encoded backslash is a site path')
assert.deepEqual(parseInline('<script>alert(1)</script>'), [{ t: 'text', v: '<script>alert(1)</script>' }], 'tags are text')
assert.deepEqual(parseInline('2 ** 3'), [{ t: 'text', v: '2 ** 3' }], 'lone asterisks are text')

assert.equal(notesToPlain('Click **More info**, see [docs](/help).\n\n- a\n- b'), 'Click More info, see docs. a; b')
assert.equal(versionAnchor('0.8.0-beta.2'), 'v0-8-0-beta-2')
console.log('notes: ok')
