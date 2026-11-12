// Coordinator only: node src/features/maintenance/maintenance.check.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { maintenanceCopy } from './copy.ts'
import { normalizeText, parsePublicNotice, parseSettings, textLength, validateSettings } from './contract.ts'

const draft = { enabled: false, text_ru: '', text_en: '' }
assert.deepEqual(validateSettings(draft), {})
assert.deepEqual(validateSettings({ ...draft, enabled: true }), { text_ru: 'required' })
assert.deepEqual(validateSettings({ ...draft, enabled: true, text_ru: ' \n\t ' }), { text_ru: 'required' })
assert.equal(normalizeText('  Технические работы\r\nСайт доступен.  '), 'Технические работы\nСайт доступен.')
assert.equal(textLength('😀'.repeat(500)), 500)
assert.deepEqual(validateSettings({ ...draft, text_ru: '😀'.repeat(500) }), {})
assert.equal(validateSettings({ ...draft, text_en: 'x'.repeat(501) }).text_en, 'length')
for (const text of ['<script>alert(1)</script>', '**bold**', '_italic_', '~~gone~~', '[link](https://example.com)', 'https://example.com', 'example.com', 'www.example.com', '# Heading', '- Markdown list', '`code`', 'bad\u0000text']) {
  assert.equal(validateSettings({ ...draft, text_ru: text }).text_ru, 'plain', text)
}
assert.deepEqual(parseSettings(draft), draft)
assert.throws(() => parseSettings({ ...draft, enabled: true }))
assert.throws(() => parseSettings({ ...draft, text_en: 3 }))
assert.throws(() => parseSettings(null))
assert.deepEqual(parsePublicNotice({ enabled: true, text: 'Технические работы.' }), { enabled: true, text: 'Технические работы.' })
assert.deepEqual(parsePublicNotice({ enabled: false, text: 'Old notice' }), { enabled: false, text: '' })
assert.throws(() => parsePublicNotice({ enabled: true, text: '' }))
assert.throws(() => parsePublicNotice({ enabled: true, text: '<b>Notice</b>' }))
assert.throws(() => parsePublicNotice({ enabled: 'true', text: 'Notice' }))
for (const copy of Object.values(maintenanceCopy)) {
  assert.ok(copy.title && copy.lead && copy.enabled && copy.save && copy.saved)
  assert.ok(copy.errors.required && copy.errors.length && copy.errors.plain)
  assert.ok(copy.fallback && copy.hint)
}

// Wiring assertions only, not substitutes for rendered/browser interaction checks.
const source = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const banner = source('./MaintenanceBanner.tsx')
assert.match(banner, /60_000/)
assert.match(banner, /document.visibilityState === 'hidden'/)
assert.match(banner, /removeEventListener\('visibilitychange'/)
assert.match(banner, /window.clearInterval\(timer\)/)
assert.match(banner, /if \(!current\?\.enabled \|\| !current.text\) return null/)
assert.match(banner, /\{current.text\}/)
assert.doesNotMatch(banner, /dangerouslySetInnerHTML|<Markdown|<button|position:\s*(?:fixed|absolute)/)
const editor = source('../../pages/admin/Maintenance.tsx')
assert.match(editor, /user\?\.role === 'admin'/)
assert.match(editor, /if \(inFlight.current\) return/)
assert.match(editor, /<fieldset disabled=\{busy\}/)
assert.match(editor, /ruRef.current\?\.focus\(\)/)
assert.match(editor, /enRef.current\?\.focus\(\)/)
assert.match(editor, /<Textarea[\s\S]*?name="text_ru"/)
assert.match(editor, /<Textarea[\s\S]*?name="text_en"/)
assert.match(editor, /setSaved\(true\)/)
assert.match(source('./maintenance.css'), /white-space:\s*pre-wrap/)
assert.match(source('./maintenance.css'), /overflow-wrap:\s*anywhere/)
assert.match(source('./api.ts'), /api.patch<unknown>\('\/admin\/maintenance-notice'/)
console.log('Maintenance validation and source wiring assertions passed (not browser coverage).')
