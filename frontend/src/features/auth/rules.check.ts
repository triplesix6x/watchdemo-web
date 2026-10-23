// Run: node src/features/auth/rules.check.ts
import assert from 'node:assert/strict'
import { PASSWORD_RULES, USERNAME_RULES, emailError, firstBroken, isEmail, passwordError, safeNext, usernameError } from './rules.ts'
import { ru } from '../../i18n/ru.ts'

assert.equal(firstBroken(PASSWORD_RULES, 'Short1'), 'length')
assert.equal(firstBroken(PASSWORD_RULES, 'alllowercase1'), 'upper')
assert.equal(firstBroken(PASSWORD_RULES, 'ПарольБезЛатиницы1'), 'upper', 'Cyrillic capitals do not count, as on the server')
assert.equal(firstBroken(PASSWORD_RULES, 'NoDigitsHere'), 'digit')
assert.equal(firstBroken(PASSWORD_RULES, 'Password123'), null)

assert.equal(firstBroken(USERNAME_RULES, 'ab'), 'length')
assert.equal(firstBroken(USERNAME_RULES, 'dimon awp'), 'chars')
assert.equal(firstBroken(USERNAME_RULES, 'дима_awp-2'), null, 'Unicode letters pass like str.isalnum()')
assert.equal(firstBroken(USERNAME_RULES, 'x'.repeat(51)), 'length')

assert.ok(isEmail('player@gmail.com'))
assert.ok(!isEmail('player@'))

assert.equal(safeNext('/account/security?x=1'), '/account/security?x=1')
assert.equal(safeNext('//evil.example'), null)
assert.equal(safeNext('/\\evil.example'), null)
assert.equal(safeNext('https://evil.example'), null)
assert.equal(safeNext(null), null)
assert.equal(passwordError('', ru), ru.validation.required)
assert.equal(passwordError('NoDigitsHere', ru), ru.authErrors.passwordDigit)
assert.equal(passwordError('Password123', ru), null)
assert.equal(usernameError('  ', ru), ru.validation.required)
assert.equal(usernameError('dimon awp', ru), ru.authErrors.usernameChars)
assert.equal(emailError('player@', ru), ru.validation.email)
assert.equal(emailError('player@gmail.com', ru), null)
console.log('auth rules: ok')
