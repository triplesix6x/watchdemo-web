// Run: node src/lib/userAgent.check.ts
import assert from 'node:assert/strict'
import { deviceName, parseDevice } from './userAgent.ts'
import { ru } from '../i18n/ru.ts'

assert.deepEqual(parseDevice(null), { kind: 'app', version: null })
assert.deepEqual(parseDevice('WatchDemo/0.7.6 (Windows)'), { kind: 'app', version: '0.7.6' })
assert.deepEqual(parseDevice('python-httpx/0.27'), { kind: 'app', version: null })
const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
assert.deepEqual(parseDevice(chrome), { kind: 'browser', browser: 'Chrome', os: 'Windows', mobile: false })
const edge = chrome + ' Edg/141.0.0.0'
assert.equal((parseDevice(edge) as { browser: string }).browser, 'Edge')
const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1'
assert.deepEqual(parseDevice(ios), { kind: 'browser', browser: 'Safari', os: 'iOS', mobile: true })
assert.equal(deviceName(parseDevice('WatchDemo/0.7.6 (Windows)'), ru), 'Приложение WatchDemo 0.7.6 · Windows')
assert.equal(deviceName(parseDevice(null), ru), 'Приложение WatchDemo · Windows')
assert.equal(deviceName(parseDevice(chrome), ru), 'Chrome, Windows')
console.log('userAgent: ok')
