import assert from 'node:assert/strict'
import ru from '../../i18n/pages/home.ru.ts'
import en from '../../i18n/pages/home.en.ts'

// Home renders the suffix separately without changing the original sentence.
for (const { hero } of [ru, en]) {
  assert.ok(hero.leadAccent.length > 0 && hero.leadAccent.length < hero.lead.length)
  assert.ok(hero.lead.endsWith(hero.leadAccent), 'The highlighted phrase must be the exact localized suffix')
}
console.log('hero accent: ok')
