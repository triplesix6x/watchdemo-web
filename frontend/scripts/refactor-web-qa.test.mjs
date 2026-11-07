import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ORIGIN, matrix, selection, completeness, requireURL, externalDirectory, disjointDirectories, compareRecords } from './refactor-web-qa-contract.mjs'
import { staticBuildConfig, mountedHTML, staticResponse, staticHandler } from './refactor-web-qa-static.mjs'

test('exact W1 loopback and API rejection occurs before any request', () => {
  let requests = 0
  const request = value => { requireURL(value); requests++ }
  for (const value of ['https://watchdemo.pro', 'http://127.example.com:55450', 'http://localhost:55450', 'http://127.0.0.1:4400', `${ORIGIN}/api/users`, `${ORIGIN}/%61pi/users`, `${ORIGIN}/%`, 'http://user:pw@127.0.0.1:55450/']) assert.throws(() => request(value))
  assert.equal(requests, 0)
  request(`${ORIGIN}/src/main.tsx`)
  assert.equal(requests, 1)
})

test('compare rejects failed or malformed baseline health before output, dependencies or browser setup', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'refactor-web-baseline-health-'))
  try {
    const baseline = path.join(temp, 'baseline')
    const deps = path.join(temp, 'deps')
    await fs.mkdir(baseline)
    await fs.mkdir(deps)
    const key = 'home-390-ru-no-preference'
    const invalid = [
      { ledger: [], failure: 'blocked request' },
      { ledger: [{ type: 'console', text: 'error' }] },
      { ledger: null },
      { ledger: {} },
      {},
    ]
    for (const [index, health] of invalid.entries()) {
      await fs.writeFile(path.join(baseline, 'manifest.json'), JSON.stringify({ version: 2, cases: [{ key }], ...health }))
      const output = path.join(temp, `output-${index}`)
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./refactor-web-qa.mjs', import.meta.url)),
        '--command', 'compare', '--mode', 'diagnostic', '--cases', key, '--budget', '3',
        '--baseline', baseline, '--output', output, '--deps-root', deps, '--edge', process.execPath],
      { encoding: 'utf8', timeout: 10000 })
      assert.ifError(result.error)
      assert.notEqual(result.status, 0)
      await assert.rejects(fs.stat(output), { code: 'ENOENT' }, `invalid baseline ${index} must not create output`)
      assert.match(result.stderr, /Baseline capture failed or has an invalid request ledger/)
    }
  } finally { await fs.rm(temp, { recursive: true, force: true }) }
})

test('diagnostic requires explicit small selection and layered capture budget', () => {
  const key = 'home-390-ru-no-preference'
  assert.throws(() => selection({ mode: 'diagnostic', budget: 3 }))
  assert.throws(() => selection({ mode: 'diagnostic', cases: key, budget: 2 }))
  assert.throws(() => selection({ mode: 'diagnostic', cases: `${key},${key}`, budget: 6 }))
  assert.throws(() => selection({ mode: 'diagnostic', cases: 'fiction', budget: 3 }))
  assert.throws(() => selection({ mode: 'diagnostic', cases: matrix().slice(0, 4).map(c => c.key).join(','), budget: 12 }))
  assert.equal(selection({ mode: 'diagnostic', cases: key, budget: 3 }).length, 1)
  assert.throws(() => selection({ mode: 'full', cases: key, budget: 9999 }))
})

test('full representative matrix detects missing, duplicate and foreign cases explicitly', () => {
  const keys = matrix().map(c => c.key)
  assert.equal(new Set(keys).size, keys.length)
  assert.deepEqual(completeness(keys), { missing: [], unexpected: [], duplicated: [] })
  assert.deepEqual(completeness([...keys.slice(1), keys[1], 'foreign']), { missing: [keys[0]], duplicated: [keys[1]], unexpected: ['foreign'] })
  assert.equal(selection({ mode: 'full', budget: matrix().reduce((n, c) => n + c.captures, 0) }).length, keys.length)
})

test('D25 layers retain state languages, principal widths and explicit noise probes without Cartesian expansion', () => {
  const all = matrix()
  assert.deepEqual([...new Set(all.filter(c => c.id === 'home').map(c => c.width))], [375, 390, 430, 1280, 1920])
  const state = all.filter(c => c.id === 'login-error')
  assert.deepEqual(state.map(c => [c.width, c.lang, c.captures]), [[390, 'ru', 1], [390, 'en', 1], [1280, 'ru', 1], [1280, 'en', 1]])
  assert.ok(all.filter(c => c.captures === 3).every(c => c.layer === 'principal-layout' && [390, 1280].includes(c.width) && c.motion === 'no-preference'))
  assert.ok(all.every(c => c.rationale.includes('D25')))
  assert.equal(all.length, 169)
  assert.equal(all.reduce((n, c) => n + c.captures, 0), 245)
  const single = { key: 'single', contract: { captures: 1 }, samples: [{ png: 'p', dom: 'd' }] }
  assert.equal(compareRecords(single, single).noiseMeasured, false)
})

test('D21 rejects missing expectations, marks noise unresolved, never tolerates stable differences', () => {
  const base = { key: 'case', samples: Array.from({ length: 3 }, () => ({ png: 'a', dom: 'd' })) }
  assert.throws(() => compareRecords(null, base))
  assert.throws(() => compareRecords({ ...base, samples: [] }, base))
  assert.equal(compareRecords(base, base).status, 'exact-match-review-required')
  const noisy = { ...base, samples: [...base.samples.slice(0, 2), { png: 'b', dom: 'd' }] }
  assert.equal(compareRecords(noisy, base).status, 'noise-unresolved')
  assert.equal(compareRecords(base, noisy).status, 'noise-unresolved')
  const changed = { ...base, samples: Array.from({ length: 3 }, () => ({ png: 'b', dom: 'd' })) }
  assert.equal(compareRecords(base, changed).status, 'regression-review-required')
})

test('isolated production build uses actual site and mounted entries without config, env or dev transport', () => {
  const frontend = path.resolve('fixture/frontend'), deps = path.resolve('fixture/deps'), output = path.resolve('fixture/output')
  const config = staticBuildConfig(frontend, deps, output, ['react', 'react-dom'])
  assert.equal(config.configFile, false)
  assert.equal(config.envFile, false)
  assert.deepEqual(config.envPrefix, [])
  assert.equal(config.mode, 'production')
  assert.deepEqual(config.define, { __MOCK__: 'true' })
  assert.deepEqual(config.css.postcss, { plugins: [] })
  assert.equal(config.root, frontend)
  assert.equal(config.base, '/')
  assert.equal(config.cacheDir, path.join(output, 'vite-cache'))
  assert.equal(config.build.outDir, path.join(output, 'site'))
  assert.equal(config.build.emptyOutDir, false)
  assert.equal(config.build.manifest, true)
  assert.deepEqual(config.build.rollupOptions.input, { site: path.join(frontend, 'index.html'), mounted: path.join(frontend, 'scripts/refactor-web-qa-mounted.tsx') })
  assert.deepEqual(config.resolve.dedupe, ['react', 'react-dom'])
  assert.deepEqual(config.resolve.alias, ['react', 'react-dom'].map(find => ({ find, replacement: path.join(deps, 'node_modules', find).replaceAll('\\', '/') })))
  assert.equal(config.build.cssCodeSplit, undefined, 'Keep Vite default CSS splitting')
  assert.equal(config.build.rollupOptions.output, undefined, 'Keep Vite asset graph and ordering')
  assert.equal(config.server, undefined)
  assert.equal(config.plugins, undefined)
})

test('built mounted HTML follows only its manifest imports and deduplicates shared CSS in dependency order', () => {
  const manifest = {
    'index.html': { isEntry: true, src: 'index.html', file: 'assets/site.js', css: ['assets/site-only.css'] },
    'scripts/refactor-web-qa-mounted.tsx': { isEntry: true, src: 'scripts/refactor-web-qa-mounted.tsx', file: 'assets/mounted.js', imports: ['_controls.js', '_shared.js'], css: ['assets/mounted.css'] },
    '_controls.js': { file: 'assets/controls.js', imports: ['_shared.js'], css: ['assets/controls.css'] },
    '_shared.js': { file: 'assets/shared.js', css: ['assets/shared.css'] },
  }
  const html = mountedHTML(manifest)
  assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]), ['/assets/shared.css', '/assets/controls.css', '/assets/mounted.css'])
  assert.ok(html.includes('<div id="root"></div>'))
  assert.ok(html.includes('src="/assets/mounted.js"'))
  assert.ok(!html.includes('site-only.css'))
  assert.throws(() => mountedHTML({}), /exactly one/)
  assert.throws(() => mountedHTML({ ...manifest, '_shared.js': undefined }), /Missing built manifest import/)
  assert.throws(() => mountedHTML({ 'scripts/refactor-web-qa-mounted.tsx': { isEntry: true, file: '../escape.js' } }), /Invalid built asset path/)
})

test('actual static responder serves built entries, owned SPA routes and MIME without source fallback or path escape', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'refactor-web-static-'))
  try {
    const site = path.join(temp, 'site'), outside = path.join(temp, 'outside')
    await fs.mkdir(path.join(site, 'assets'), { recursive: true })
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'secret.js'), 'outside')
    await fs.symlink(outside, path.join(site, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await fs.writeFile(path.join(site, 'index.html'), '<main>actual built site</main>')
    await fs.writeFile(path.join(site, '__refactor-mounted.html'), '<main>built mounted entry</main>')
    await fs.writeFile(path.join(site, 'assets', 'entry.js'), 'export {}')
    await fs.writeFile(path.join(site, 'assets', 'entry.css'), 'body{}')
    await fs.writeFile(path.join(site, 'assets', 'font.woff2'), 'font')
    const root = await fs.realpath(site)
    const request = (url, extra = {}) => staticResponse(root, { method: 'GET', host: '127.0.0.1:55450', url, ...extra })
    assert.equal((await request('/')).body.toString(), '<main>actual built site</main>')
    assert.equal((await request('/en/login?next=account')).status, 200)
    assert.equal((await request('/__ui')).status, 200)
    assert.equal((await request('/__refactor-mounted.html')).body.toString(), '<main>built mounted entry</main>')
    for (const [url, type] of [['/assets/entry.js', 'text/javascript; charset=utf-8'], ['/assets/entry.css', 'text/css; charset=utf-8'], ['/assets/font.woff2', 'font/woff2']]) {
      assert.equal((await request(url)).headers['Content-Type'], type)
      const head = await request(url, { method: 'HEAD' })
      assert.equal(head.status, 200)
      assert.equal(head.body, undefined)
    }
    for (const url of ['/assets/missing.js', '/src/main.tsx', '/@vite/client', '/not-owned', '/en/__ui']) assert.equal((await request(url)).status, 404, url)
    for (const url of ['/../outside/secret.js', '/%2e%2e/outside/secret.js', '/assets/../../outside/secret.js', '/escape/secret.js']) assert.equal((await request(url)).status, 403, url)
    for (const url of ['/%', '/%00', '/%5csecret', '//elsewhere/file', 'http://127.0.0.1:55450/', '/api/users', '/%61pi/users']) assert.equal((await request(url)).status, 400, url)
    assert.equal((await request('/', { host: 'localhost:55450' })).status, 403)
    assert.equal((await request('/', { method: 'POST' })).status, 405)
    const headers = {}
    let status, body
    await staticHandler(root)({ method: 'GET', headers: { host: '127.0.0.1:55450' }, url: '/assets/entry.js' }, {
      setHeader(name, value) { headers[name] = value },
      writeHead(value, extra) { status = value; Object.assign(headers, extra); return this },
      end(value) { body = value },
    })
    assert.equal(status, 200)
    assert.equal(headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(headers['Cache-Control'], 'no-store')
    assert.equal(body.toString(), 'export {}')
  } finally { await fs.rm(temp, { recursive: true, force: true }) }
})

test('exclusive external outputs reject Git worktrees, nested repositories and reuse', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'refactor-web-safety-'))
  try {
    const repo = path.join(temp, 'repo')
    await fs.mkdir(repo)
    await fs.writeFile(path.join(repo, '.git'), 'gitdir: elsewhere')
    await assert.rejects(externalDirectory(path.join(repo, 'artifacts'), { fresh: true }), /outside all repositories/)
    await assert.rejects(externalDirectory('relative', { fresh: true }))
    const output = await externalDirectory(path.join(temp, 'new'), { fresh: true })
    await assert.rejects(externalDirectory(output, { fresh: true }), /EEXIST/)
    assert.equal(await externalDirectory(output), output)
    assert.throws(() => disjointDirectories(output, path.join(output, 'child')))
    assert.throws(() => disjointDirectories(output, output))
    disjointDirectories(output, path.join(temp, 'other'))
  } finally { await fs.rm(temp, { recursive: true, force: true }) }
})
