// Run: node src/api/errors.check.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { Code, toApiError } from './errors.ts'
import { ru } from '../i18n/ru.ts'

const doc = fs.readFileSync(new URL('../../../docs/ERROR-CODES.md', import.meta.url), 'utf8')
const documented = [...doc.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]).sort()
assert.deepEqual(Object.values(Code).sort(), documented, 'Code matches docs/ERROR-CODES.md')

const text = (status: number, code: string, extra: object = {}) => toApiError(status, { message: 'English, never shown', code, ...extra }, ru).message
const seconds = (template: string, n: number) => template.replace('{seconds}', String(n))

assert.equal(text(422, 'password_weak', { rule: 'digit' }), ru.authErrors.passwordDigit)
assert.equal(text(422, 'password_weak', { rule: 'min_length', min_length: 10 }), ru.authErrors.passwordLength)
assert.equal(text(401, 'invalid_credentials', { attempts_remaining: 2 }), 'Неверный логин или пароль. Осталось попыток: 2.')
assert.equal(text(403, 'target_deactivated'), ru.adminErrors.targetDeactivated, 'the target, not the caller')
assert.equal(text(403, 'account_deactivated'), ru.authErrors.deactivated)
assert.equal(text(403, 'cannot_target_self'), ru.authErrors.selfAction)
assert.equal(text(403, 'target_role_too_high'), ru.authErrors.targetRoleTooHigh)
assert.equal(text(500, 'internal_error'), ru.errors.server)
assert.equal(text(409, 'some_future_code'), ru.errors.conflict, 'an unknown code falls back to the status')
assert.equal(toApiError(502, null, ru).message, ru.errors.server, 'a proxy page without a body')

const v = toApiError(422, { code: 'validation_failed', detail: [{ loc: ['body', 'password'], type: 'string_too_short', ctx: { min_length: 10 } }] }, ru)
assert.deepEqual(Object.keys(v.fields), ['password'])
assert.equal(v.message, v.fields.password, 'one field: its own message')
const two = toApiError(422, { code: 'validation_failed', detail: [{ loc: ['body', 'a'], type: 'missing' }, { loc: ['body', 'b'], type: 'missing' }] }, ru)
assert.equal(two.message, ru.errors.validation)
const name = toApiError(422, { code: 'validation_failed', detail: [{ loc: ['body', 'username'], type: 'value_error', msg: 'Value error, Username may only contain letters, digits, _ and -' }] }, ru)
assert.equal(name.fields.username, ru.authErrors.usernameChars)

const locked = toApiError(429, { code: 'too_many_attempts', message: 'Account locked', retry_after_seconds: 30 }, ru)
assert.equal(locked.retryAfter, 30)
assert.equal(locked.message, seconds(ru.authErrors.accountLocked, 30))
const limited = toApiError(429, { code: 'rate_limited', message: 'Too many requests', detail: 'Too many requests' }, ru, '12')
assert.equal(limited.message, seconds(ru.errors.tooManyRequestsIn, 12), 'the Retry-After header')
console.log('errors: ok')
