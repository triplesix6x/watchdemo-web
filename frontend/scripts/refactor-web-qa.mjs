import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { createServer as createHTTPServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { staticBuildConfig, mountedHTML, staticHandler } from './refactor-web-qa-static.mjs'
import { ORIGIN, VERSION, FIXED_TIME, SEED, selection, completeness, externalDirectory, disjointDirectories, compareRecords, requireURL } from './refactor-web-qa-contract.mjs'
import { interact, domRecord } from './refactor-web-qa-scenarios.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.resolve(here, '..')
const repo = path.resolve(frontend, '..')
const hash = value => createHash('sha256').update(value).digest('hex')
const browserArgs = ['--disable-background-networking', '--disable-component-update', '--no-first-run', '--disable-gpu']
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'))
const save = (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' })
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim()

async function sourceIdentity() {
  const files = execFileSync('git', ['-C', repo, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', 'frontend', 'docs/browser-refactor-web'], { encoding: 'utf8' }).split('\0').filter(Boolean).sort()
  const hashes = {}
  for (const file of files) {
    if (/(^|\/)\.env(?:\.|$)/.test(file)) continue // Never read dotenv/source secrets.
    hashes[file] = hash(await fs.readFile(path.join(repo, file)))
  }
  return { head: git('rev-parse', 'HEAD'), status: git('status', '--short'), hashes, sha256: hash(JSON.stringify(hashes)) }
}
async function dependencyIdentity(deps) {
  const names = ['vite', 'playwright-core', 'react', 'react-dom', 'react-router-dom', 'gsap', 'lenis', 'lucide-react', '@fontsource/onest']
  const packages = {}
  for (const name of names) {
    const bytes = await fs.readFile(path.join(deps, 'node_modules', name, 'package.json'))
    packages[name] = { version: JSON.parse(bytes).version, manifestSha256: hash(bytes) }
  }
  const lock = await fs.readFile(path.join(deps, 'package-lock.json'))
  return { root: deps, packages, lockSha256: hash(lock) }
}
async function within(promise, label, timeout = 15000) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Timed out waiting for ${label}`)), timeout) })])
  } finally { clearTimeout(timer) }
}
async function assetsReady(page, inflight) {
  await within(page.evaluate(async () => {
    document.body.getBoundingClientRect()
    await document.fonts.ready
    await Promise.all([...document.images].map(image => image.decode()))
  }), 'fonts and image decoding')
  const deadline = Date.now() + 15000
  while (true) {
    const ready = await within(page.evaluate(() => document.fonts.status === 'loaded' && [...document.images].every(image => image.complete && image.naturalWidth > 0)), 'asset status', Math.max(1, deadline - Date.now()))
    if (ready && inflight.size === 0) return
    if (Date.now() >= deadline) throw Error('Timed out waiting for finite asset/HTTP completion')
    await delay(50)
  }
}
async function main() {
  const { values: a } = parseArgs({ options: Object.fromEntries(['command', 'mode', 'cases', 'budget', 'output', 'baseline', 'deps-root', 'edge'].map(k => [k, { type: 'string' }])) })
  if (!['capture', 'compare'].includes(a.command)) throw Error('Explicit --command capture|compare required')
  if (a.command === 'capture' && a.baseline) throw Error('Capture cannot read or promote a baseline')
  if (a.command === 'compare' && !a.baseline) throw Error('Compare requires a read-only baseline directory')
  const selected = selection({ mode: a.mode, cases: a.cases, budget: Number(a.budget) })
  if (!a['deps-root'] || !path.isAbsolute(a['deps-root']) || !a.edge || !path.isAbsolute(a.edge)) throw Error('Explicit absolute --deps-root and --edge required; never install')
  const deps = await fs.realpath(a['deps-root'])
  const edge = await fs.realpath(a.edge)
  // W0 must already be integrated. Missing helper is an unexecuted gate, never
  // permission to import the regular Vite config or use a normal dev server.
  const safety = await import(pathToFileURL(path.join(here, 'qa-safety.mjs')).href)
  if (typeof safety.guardContext !== 'function') throw Error('Integrated W0 guardContext required')
  const baseline = a.baseline ? await externalDirectory(a.baseline) : null
  const prior = baseline ? await json(path.join(baseline, 'manifest.json')) : null
  if (baseline) {
    if (!prior || typeof prior !== 'object' || Array.isArray(prior) || Object.hasOwn(prior, 'failure') || !Array.isArray(prior.ledger) || prior.ledger.length) throw Error('Baseline capture failed or has an invalid request ledger')
    if (prior.version !== VERSION) throw Error('Baseline version mismatch')
    const keys = prior.cases.map(c => c.key)
    if (new Set(keys).size !== keys.length) throw Error('Duplicate baseline cases')
    if (a.mode === 'full' && Object.values(completeness(keys)).some(v => v.length)) throw Error('Full baseline has missing or unexpected cases')
    for (const c of selected) if (!keys.includes(c.key)) throw Error(`Missing expected baseline case: ${c.key}`)
  }
  const output = await externalDirectory(a.output, { fresh: true })
  if (baseline) disjointDirectories(baseline, output)
  disjointDirectories(deps, output)
  const source = await sourceIdentity()
  const dependencies = await dependencyIdentity(deps)
  const require = createRequire(path.join(deps, 'package.json'))
  const { build } = await import(pathToFileURL(path.join(path.dirname(require.resolve('vite/package.json')), 'dist/node/index.js')).href)
  const { chromium } = require('playwright-core')
  const packageJSON = await json(path.join(frontend, 'package.json'))
  const buildConfig = staticBuildConfig(frontend, deps, output, Object.keys(packageJSON.dependencies))
  const environment = { serving: 'isolated-production-build-static-http', rendererPolicy: 'D26-software-visual-golden-not-performance', browserArgs, node: process.version, os: { platform: os.platform(), release: os.release(), arch: os.arch() }, dependencies, browserExecutable: edge, browserSha256: hash(await fs.readFile(edge)), time: FIXED_TIME, seed: SEED, dpr: 1, origin: ORIGIN, clock: 'Playwright virtual clock; explicit runFor only; no animation disabling', fixture: 'existing src/api/mock graph, plus production useAsync deferred-order fixture', motionPrimary: 'no-preference' }
  if (prior) {
    const { browserVersion: _learned, ...priorEnvironment } = prior.environment
    if (JSON.stringify(priorEnvironment) !== JSON.stringify(environment)) throw Error('Environment mismatch: recapture separately; do not compare unlike GPU/browser/dependencies')
  }
  const manifest = { version: VERSION, command: a.command, mode: a.mode, accepting: false, status: 'INCOMPLETE: parent DOM/golden review and remaining module gates required', source, environment, selected: selected.map(c => c.key), cases: [], ledger: [], diagnostics: [] }
  let server, browser
  try {
    // mkdir is exclusive: Vite must never empty/reuse any previous build output.
    const site = path.join(output, 'site')
    await fs.mkdir(site)
    await build(buildConfig)
    await fs.writeFile(path.join(site, '__refactor-mounted.html'), mountedHTML(await json(path.join(site, '.vite/manifest.json'))), { flag: 'wx' })
    const root = await fs.realpath(site)
    server = createHTTPServer(staticHandler(root))
    server.on('upgrade', (_request, socket) => socket.destroy())
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(55450, '127.0.0.1', resolve)
    })
    browser = await chromium.launch({ executablePath: edge, headless: true, args: browserArgs })
    manifest.environment.browserVersion = browser.version()
    if (prior && prior.environment.browserVersion !== browser.version()) throw Error('Browser build mismatch')
    for (const c of selected) {
      const result = { key: c.key, contract: c, samples: [] }
      for (let repeat = 0; repeat < c.captures; repeat++) {
        const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: 1, locale: c.lang === 'ru' ? 'ru-RU' : 'en-US', timezoneId: 'UTC', reducedMotion: c.motion, serviceWorkers: 'block' })
        const inflight = new Map()
        const diagnostics = { case: c.key, repeat, requestFailed: [], httpErrors: [], inflight: [] }
        manifest.diagnostics.push(diagnostics)
        const onRequest = request => inflight.set(request, { url: request.url(), method: request.method(), resourceType: request.resourceType() })
        const onFinished = request => inflight.delete(request)
        const onFailed = request => {
          const failure = { ...inflight.get(request), url: request.url(), error: request.failure()?.errorText ?? 'unknown request failure' }
          diagnostics.requestFailed.push(failure)
          manifest.ledger.push({ case: c.key, repeat, kind: 'requestfailed', ...failure })
          inflight.delete(request)
        }
        const onResponse = response => {
          if (response.status() >= 400) {
            const failure = { url: response.url(), status: response.status() }
            diagnostics.httpErrors.push(failure)
            manifest.ledger.push({ case: c.key, repeat, kind: 'http-error', ...failure })
          }
        }
        context.on('request', onRequest)
        context.on('requestfinished', onFinished)
        context.on('requestfailed', onFailed)
        context.on('response', onResponse)
        try {
          // W0's guardContext accepts a target object; qaTarget's legacy 4400
          // allowlist is intentionally not broadened. W1 validates its own exact
          // 55450 origin before delegation. No raw context.request is used here.
          await safety.guardContext(context, { origin: ORIGIN, mode: 'mock-browser' }, url => manifest.ledger.push({ case: c.key, repeat, kind: 'blocked-request', url }))
          await context.addInitScript(({ persona, storage, seed }) => {
            localStorage.setItem('wd-mock-user', persona)
            localStorage.setItem('wd-mock-delay', '280')
            for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value)
            let state = seed
            Math.random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296 }
            crypto.randomUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16) })
          }, { persona: c.persona, storage: c.storage, seed: SEED })
          const page = await context.newPage()
          page.setDefaultTimeout(15000)
          page.on('pageerror', e => manifest.ledger.push({ case: c.key, repeat, kind: 'pageerror', message: e.message }))
          page.on('console', m => { if (m.type() === 'error') manifest.ledger.push({ case: c.key, repeat, kind: 'console-error', message: m.text() }) })
          await page.clock.install({ time: new Date(FIXED_TIME) })
          await page.clock.pauseAt(new Date(FIXED_TIME))
          const prefix = c.lang === 'en' && c.url !== '/__refactor-mounted.html' ? '/en' : ''
          await page.goto(requireURL(`${ORIGIN}${prefix}${c.url}`), { waitUntil: 'load' })
          await within(page.evaluate(() => document.fonts.ready), 'initial fonts')
          const assertions = await interact(page, c)
          // No networkidle, timer flushing, or animation overrides. Loading-case
          // mock promises stay pending at their existing virtual 1200ms boundary.
          await assetsReady(page, inflight)
          const gpu = await page.evaluate(() => {
            const gl = document.createElement('canvas').getContext('webgl')
            if (!gl) return { available: false }
            const info = gl.getExtension('WEBGL_debug_renderer_info')
            const identity = { available: true, vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER), unmaskedVendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : null, unmaskedRenderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null }
            gl.getExtension('WEBGL_lose_context')?.loseContext()
            return identity
          })
          const stem = `${c.key}-${repeat}`
          const dom = await domRecord(page)
          await save(path.join(output, `${stem}.json`), dom)
          const png = await page.screenshot({ path: path.join(output, `${stem}.png`), fullPage: true })
          result.samples.push({ png: hash(png), dom: hash(JSON.stringify(dom)), stem, gpu, assertions, virtualTime: await page.evaluate(() => Date.now()), viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, language: navigator.language, fonts: document.fonts.status })) })
        } finally {
          diagnostics.inflight = [...inflight.values()]
          if (diagnostics.inflight.length) manifest.ledger.push({ case: c.key, repeat, kind: 'inflight-at-capture-end', requests: diagnostics.inflight })
          context.off('request', onRequest)
          context.off('requestfinished', onFinished)
          context.off('requestfailed', onFailed)
          context.off('response', onResponse)
          await context.close()
        }
      }
      if (prior) {
        const expected = prior.cases.find(x => x.key === c.key)
        // Missing or tampered artifacts are not an empty/auto-created baseline.
        for (const sample of expected.samples) {
          if (!/^[a-z0-9-]+$/.test(sample.stem)) throw Error('Invalid expected artifact name')
          if (hash(await fs.readFile(path.join(baseline, `${sample.stem}.png`))) !== sample.png || hash(JSON.stringify(await json(path.join(baseline, `${sample.stem}.json`)))) !== sample.dom) throw Error('Expected artifact integrity failure')
        }
        if (JSON.stringify(expected.samples.map(s => s.gpu)) !== JSON.stringify(result.samples.map(s => s.gpu))) throw Error('GPU identity mismatch')
        result.comparison = compareRecords(expected, result)
      } else result.repeatNoise = compareRecords(result, result)
      manifest.cases.push(result)
    }
    manifest.completeness = completeness(manifest.cases.map(c => c.key))
    if (a.mode === 'full' && Object.values(manifest.completeness).some(v => v.length)) throw Error('Full matrix missing, duplicated or unexpected cases')
    if (manifest.ledger.length) throw Error('Blocked requests/page or console errors require investigation')
    if (manifest.cases.some(c => c.comparison && (!c.comparison.stable || !c.comparison.equal))) throw Error('D21 unresolved noise or regression; review external artifacts')
    if (manifest.cases.some(c => c.repeatNoise && !c.repeatNoise.stable)) manifest.status = 'INCOMPLETE: repeated unchanged capture has unresolved noise; no tolerance inferred'
  } catch (error) {
    manifest.failure = error.stack
    throw error
  } finally {
    manifest.completeness = completeness(manifest.cases.map(c => c.key))
    try { await browser?.close() } finally {
      try {
        if (server) {
          const closing = new Promise((resolve, reject) => server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()))
          server.closeAllConnections()
          await closing
        }
      } finally { await save(path.join(output, 'manifest.json'), manifest) }
    }
  }
  console.log(`INCOMPLETE/nonaccepting ${a.mode}: ${selected.length} layered cases, ${selected.reduce((n, c) => n + c.captures, 0)} captures. ${output}`)
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
