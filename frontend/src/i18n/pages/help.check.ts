// Coordinator only: node src/i18n/pages/help.check.ts
// Copy-contract checks, not proof of desktop entitlement enforcement.
import assert from 'node:assert/strict'
import en from './help.en.ts'
import ru from './help.ru.ts'

const offlineAnswer = (dict: typeof ru) => dict.sections.flatMap((section) => section.items).find((item) => item.id === 'offline')?.a
const english = offlineAnswer(en)
const russian = offlineAnswer(ru)
assert.ok(english)
assert.ok(russian)
assert.match(english, /New imports, custom set creations and groups are unavailable offline/)
assert.match(english, /existing local library remains available with Free permissions using a previously verified account identity, even after the paid lease expires/)
assert.match(english, /Paid capabilities require an unexpired signed access lease, valid for no more than 24 hours and never beyond subscription expiry/)
assert.match(russian, /Без связи новый импорт, создание своего набора или группы недоступны/)
assert.match(russian, /локальная библиотека остаётся доступной с правами Free по ранее проверенной учётной записи, даже после истечения платного разрешения/)
assert.match(russian, /Платные возможности требуют действующего подписанного разрешения сроком не более 24 часов и не дольше оплаченной подписки/)
console.log('offline help: paid lease requirement and cached Free library access copy: ok')
