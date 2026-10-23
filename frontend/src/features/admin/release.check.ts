// Run: node src/features/admin/release.check.ts
import assert from 'node:assert/strict'
import { SEMVER, sortPicked, versionFromFileName } from './release.ts'

assert.equal(versionFromFileName('WatchDemo_0.8.0_x64-setup.exe'), '0.8.0')
assert.equal(versionFromFileName('WatchDemo_0.8.0-beta.2_x64-setup.exe'), '0.8.0-beta.2')
assert.equal(versionFromFileName('setup.exe'), null)
assert.ok(SEMVER.test('0.8.0-beta.2'))
assert.ok(!SEMVER.test('0.8'))

const file = (name: string) => ({ name }) as File
const both = sortPicked([file('WatchDemo_0.8.0-beta.1_x64-setup.exe.sig'), file('WatchDemo_0.8.0-beta.1_x64-setup.exe')])
assert.equal(both.installer?.name, 'WatchDemo_0.8.0-beta.1_x64-setup.exe')
assert.equal(both.signature?.name, 'WatchDemo_0.8.0-beta.1_x64-setup.exe.sig')
assert.equal(both.version, '0.8.0-beta.1')
assert.equal(both.beta, true, 'a pre-release suggests beta')
assert.deepEqual(sortPicked([file('build.SIG')]), { signature: file('build.SIG') }, 'a lone .sig keeps the installer')
console.log('release: ok')
