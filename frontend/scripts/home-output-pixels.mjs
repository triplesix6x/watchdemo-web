// Exact GPU-output diagnostic for the organization-only GhostFibers extraction.
// This is NOT a benchmark: synchronous readPixels deliberately stalls the GPU.
// No fixture app, production-source patch, CSS cut, software renderer or tolerance.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createServer } from 'node:http'
import { staticBuildConfig, staticHandler } from './refactor-web-qa-static.mjs'
import { ORIGIN, FIXED_TIME, SEED, externalDirectory, disjointDirectories } from './refactor-web-qa-contract.mjs'
import { guardContext } from './qa-safety.mjs'
import { hardwareGPU, warmHomepageImages } from './home-output-comparison-contract.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim()
const save = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const GHOST = 'frontend/src/features/backgrounds/GhostFibers/'
const LIMITS = Object.freeze({ files: 2048, bytes: 256 * 1024 * 1024, captureBytes: 16 * 1024 * 1024, captures: 12 })
const CLOCK = Object.freeze({ epoch: Date.parse(FIXED_TIME), seed: SEED, stepMs: 1000 / 60, readinessFrames: 180, settleFrames: 120, stateFrames: 30 })
const STATES = ['idle', 'pointer-left', 'pointer-right-pulse', 'visibility-return']
async function within(promise, label, ms = 15000) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), ms) })]) }
  finally { clearTimeout(timer) }
}
async function sourceIdentity(root) {
  const files = git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '--', 'frontend').split('\n').filter(Boolean).sort()
  const hashes = {}
  for (const file of files) {
    // Never read credentials; Vite's guarded config also disables env-file loading.
    if (/(^|\/)\.env(?:\.|$)/.test(file)) continue
    hashes[file] = hash(await fs.readFile(path.join(root, file)))
  }
  return { root, head: git(root, 'rev-parse', 'HEAD'), status: git(root, 'status', '--short', '--', 'frontend'), hashes, sha256: hash(JSON.stringify(hashes)) }
}
async function artifactBudget(root) {
  let files = 0, bytes = 0
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw Error('Artifact symlinks forbidden')
      if (entry.isDirectory()) await visit(file)
      else { files++; bytes += (await fs.stat(file)).size }
      if (files > LIMITS.files || bytes > LIMITS.bytes) throw Error('Finite artifact budget exceeded')
    }
  }
  await visit(root)
  return { files, bytes }
}

// Serialized before application scripts. The real shared GSAP clock consumes this
// finite rAF/timer scheduler; no replacement renderer or shader/uniform overrides.
function installProbe({ clock, captureBytes }) {
  let now = 0, sequence = 0, tick = 0, random = clock.seed, armed = null, capture = null, hidden = false
  let finalDraws = 0, gpu = null
  const raf = new Map(), timers = new Map(), failures = []
  const NativeDate = Date
  function FixedDate(...args) {
    if (!new.target) return new NativeDate(clock.epoch + now).toString()
    return Reflect.construct(NativeDate, args.length ? args : [clock.epoch + now], new.target)
  }
  Object.setPrototypeOf(FixedDate, NativeDate)
  FixedDate.prototype = NativeDate.prototype
  FixedDate.now = () => clock.epoch + now
  window.Date = FixedDate
  Object.defineProperty(performance, 'now', { value: () => now })
  Object.defineProperty(performance, 'timeOrigin', { value: clock.epoch })
  Math.random = () => { random = (Math.imul(1664525, random) + 1013904223) >>> 0; return random / 4294967296 }
  crypto.randomUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16) })
  window.requestAnimationFrame = callback => { const id = ++sequence; raf.set(id, callback); return id }
  window.cancelAnimationFrame = id => raf.delete(id)
  const timer = (callback, delay, interval, args) => {
    if (typeof callback !== 'function') throw Error('String timers forbidden in pixel probe')
    const id = ++sequence, duration = Math.max(interval ? 1 : 0, Number(delay) || 0)
    if (!Number.isFinite(duration)) throw Error('Nonfinite timer delay')
    timers.set(id, { callback, args, due: now + duration, interval: interval ? duration : 0 })
    return id
  }
  window.setTimeout = (callback, delay, ...args) => timer(callback, delay, false, args)
  window.setInterval = (callback, delay, ...args) => timer(callback, delay, true, args)
  window.clearTimeout = window.clearInterval = id => timers.delete(id)
  Object.defineProperty(document, 'hidden', { get: () => hidden })
  Object.defineProperty(document, 'visibilityState', { get: () => hidden ? 'hidden' : 'visible' })
  localStorage.setItem('wd-mock-user', 'anon')
  localStorage.setItem('wd-mock-delay', '280')

  const original = WebGL2RenderingContext.prototype.drawArrays
  WebGL2RenderingContext.prototype.drawArrays = function (...args) {
    const result = Reflect.apply(original, this, args) // Always draw FIRST.
    if (!this.canvas.matches?.('canvas.ghost-fibers-canvas') || this.getParameter(this.FRAMEBUFFER_BINDING) !== null) return result
    finalDraws++
    if (!gpu) {
      const extension = this.getExtension('WEBGL_debug_renderer_info')
      gpu = { renderer: this.getParameter(this.RENDERER), unmaskedRenderer: extension ? this.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null }
    }
    if (!armed) return result
    if (capture) { failures.push('Multiple default-framebuffer draws in one capture tick'); return result }
    try {
      const width = this.drawingBufferWidth, height = this.drawingBufferHeight
      const length = width * height * 4
      if (!width || !height || length > captureBytes) throw Error('Empty or over-budget framebuffer')
      // Reading must not rebind a framebuffer/buffer or alter pixel-pack state.
      if (this.getParameter(this.READ_FRAMEBUFFER_BINDING) !== null || this.getParameter(this.PIXEL_PACK_BUFFER_BINDING) !== null ||
          this.getParameter(this.PACK_ROW_LENGTH) !== 0 || this.getParameter(this.PACK_SKIP_ROWS) !== 0 || this.getParameter(this.PACK_SKIP_PIXELS) !== 0) throw Error('Unexpected read framebuffer or pixel-pack state')
      if (this.isContextLost()) throw Error('GhostFibers WebGL context lost')
      const bytes = new Uint8Array(length)
      this.readPixels(0, 0, width, height, this.RGBA, this.UNSIGNED_BYTE, bytes)
      const error = this.getError()
      if (error !== this.NO_ERROR) throw Error(`WebGL read/draw error ${error}`)
      let nontransparent = 0, nonzeroColor = 0
      const colors = new Set()
      for (let i = 0; i < bytes.length; i += 4) {
        if (bytes[i + 3]) nontransparent++
        if (bytes[i] || bytes[i + 1] || bytes[i + 2]) nonzeroColor++
        colors.add(((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0)
      }
      let binary = ''
      for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384))
      capture = { state: armed, tick, timestamp: now, finalDraws, width, height, nontransparent, nonzeroColor, colorCount: colors.size, rgbaBase64: btoa(binary) }
      if (!nontransparent || !nonzeroColor || colors.size < 2) failures.push('Empty, transparent or flat GhostFibers output')
    } catch (error) { failures.push(error.message) }
    return result
  }
  window.__homePixels = {
    step() {
      tick++; now = tick * clock.stepMs
      let delivered = 0
      while (true) {
        const next = [...timers].filter(([, value]) => value.due <= now).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0]
        if (!next) break
        if (++delivered > 10000) throw Error('Timer delivery budget exceeded')
        const [id, value] = next
        if (value.interval) value.due += value.interval
        else timers.delete(id)
        value.callback(...value.args)
      }
      const callbacks = [...raf]
      for (const [id, callback] of callbacks) if (raf.delete(id)) callback(now)
    },
    arm(state) { if (armed) throw Error('Capture already armed'); armed = state; capture = null },
    take() {
      const value = capture
      armed = null; capture = null
      if (failures.length) throw Error(failures.join('; '))
      if (!value) throw Error('No real GhostFibers final draw in capture tick')
      return value
    },
    visibility(value) { hidden = value; document.dispatchEvent(new Event('visibilitychange')) },
    info() { return { tick, timestamp: now, finalDraws, gpu, failures: [...failures] } },
  }
}

async function main() {
  const { values: a } = parseArgs({ options: Object.fromEntries(['baseline-root', 'candidate-root', 'deps-root', 'edge', 'out', 'output', 'dpr'].map(key => [key, { type: 'string' }])) })
  for (const key of ['baseline-root', 'candidate-root', 'deps-root', 'edge']) if (!a[key] || !path.isAbsolute(a[key])) throw Error(`Explicit absolute --${key} required; no install/discovery`)
  if (a.out && a.output) throw Error('Use only one of --out and --output')
  const dpr = Number(a.dpr ?? 1)
  if (![1, 2].includes(dpr)) throw Error('--dpr must be 1 or 2; production HomeBackground still owns its dpr={1}')
  const baseline = await fs.realpath(a['baseline-root']), candidate = await fs.realpath(a['candidate-root'])
  const deps = await fs.realpath(a['deps-root']), edge = await fs.realpath(a.edge)
  disjointDirectories(baseline, candidate)
  const sources = { baseline: await sourceIdentity(baseline), candidate: await sourceIdentity(candidate) }
  if (sources.baseline.status) throw Error('Baseline frontend must be clean')
  const packageBytes = await fs.readFile(path.join(candidate, 'frontend/package.json'))
  for (const file of [path.join(baseline, 'frontend/package.json'), path.join(deps, 'package.json')]) if (!packageBytes.equals(await fs.readFile(file))) throw Error('Source/dependency package manifests must match')
  const lock = await fs.readFile(path.join(deps, 'package-lock.json'))
  for (const root of [baseline, candidate]) if (!lock.equals(await fs.readFile(path.join(root, 'frontend/package-lock.json')))) throw Error('Source/dependency lockfiles must match')
  const changedFrontend = [...new Set([...Object.keys(sources.baseline.hashes), ...Object.keys(sources.candidate.hashes)])].sort()
    .filter(file => sources.baseline.hashes[file] !== sources.candidate.hashes[file])
  // Raw hashes remain recorded. Git's Windows checkout may change CRLF in
  // otherwise identical UTF-8 source; only that exact text difference is allowed.
  const outsideScope = [], checkoutEolOnly = []
  for (const file of changedFrontend) {
    if (file.startsWith('frontend/scripts/') || [GHOST + 'GhostFibers.tsx', GHOST + 'projection.ts'].includes(file)) continue
    if (/^frontend\/src\/.*\.(?:tsx?|css)$/.test(file) && sources.baseline.hashes[file] && sources.candidate.hashes[file]) {
      const text = async root => new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(path.join(root, file))).replace(/\r\n/g, '\n')
      if (await text(baseline) === await text(candidate)) { checkoutEolOnly.push(file); continue }
    }
    outsideScope.push(file)
  }
  if (outsideScope.length) throw Error(`Production frontend changes outside W7 scope: ${outsideScope.join(', ')}`)
  if (!changedFrontend.includes(GHOST + 'GhostFibers.tsx')) throw Error('Expected a real old/new GhostFibers source difference')
  const staticHelper = 'frontend/scripts/refactor-web-qa-static.mjs'
  for (const source of Object.values(sources)) if (source.hashes[staticHelper] !== sources.baseline.hashes[staticHelper]) {
    const text = async root => new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(path.join(root, staticHelper))).replace(/\r\n/g, '\n')
    if (await text(source.root) !== await text(baseline)) throw Error('Static build helper must match baseline')
    checkoutEolOnly.push(staticHelper)
  }
  const require = createRequire(path.join(deps, 'package.json'))
  const dependencyPaths = [...new Set([...Object.keys(JSON.parse(packageBytes).dependencies), 'vite', 'playwright-core', 'typescript'])]
    .map(name => [name, path.join(deps, 'node_modules', name, 'package.json')])
  async function dependencyIdentity() {
    const manifests = {}
    for (const [name, file] of dependencyPaths) { const bytes = await fs.readFile(file); manifests[name] = { version: JSON.parse(bytes).version, sha256: hash(bytes) } }
    return { packageSha256: hash(await fs.readFile(path.join(deps, 'package.json'))), lockSha256: hash(await fs.readFile(path.join(deps, 'package-lock.json'))), manifests }
  }
  const dependencies = await dependencyIdentity()
  const output = await externalDirectory(a.out ?? a.output, { fresh: true })
  for (const root of [baseline, candidate, deps]) disjointDirectories(root, output)
  const manifest = { version: 1, status: 'INCONCLUSIVE_FAIL', accepting: false, purpose: 'Exact finite GhostFibers GPU-output fidelity, not performance or whole-audit acceptance',
    sources, changedFrontend, checkoutEolOnly, dependencies, clock: CLOCK, limits: LIMITS,
    environment: { node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(), edge, edgeSha256: hash(await fs.readFile(edge)), origin: ORIGIN, viewport: { width: 390, height: 844 }, dpr },
    order: ['baseline', 'baseline', 'candidate'], states: STATES, samples: [], ledger: [],
    limitations: ['Synthetic document visibility lifecycle; not OS tab suspension.', 'Exact captures cover only the listed finite timestamps/states on this GPU/browser.', 'DPR2 changes browser DPR, not production HomeBackground dpr={1}.', 'No benchmark or speedup inference; readPixels stalls are expected.', 'Dependency identity covers lock and installed package manifests, not an adversarial same-user mutation of node_modules.'] }
  let browser, server
  let handler = (_request, response) => response.writeHead(503).end()
  try {
    const { build } = await import(pathToFileURL(path.join(path.dirname(require.resolve('vite/package.json')), 'dist/node/index.js')).href)
    const { chromium } = require('playwright-core')
    const sites = {}
    for (const [name, root] of Object.entries({ baseline, candidate })) {
      const buildRoot = path.join(output, name)
      await fs.mkdir(buildRoot)
      await fs.mkdir(path.join(buildRoot, 'site'))
      const config = staticBuildConfig(path.join(root, 'frontend'), deps, buildRoot, Object.keys(JSON.parse(packageBytes).dependencies))
      config.build.rollupOptions.input = { site: path.join(root, 'frontend/index.html') }
      await within(build(config), `${name} real production graph build`, 60000)
      sites[name] = await fs.realpath(path.join(buildRoot, 'site'))
      await artifactBudget(output)
    }
    server = createServer((request, response) => handler(request, response))
    server.on('upgrade', (_request, socket) => { if (manifest.ledger.length < 128) manifest.ledger.push({ kind: 'server-upgrade', url: _request.url }); socket.destroy() })
    await within(new Promise((resolve, reject) => { server.once('error', reject); server.listen(55450, '127.0.0.1', resolve) }), 'owned exact-origin listener')
    const args = ['--disable-background-networking', '--disable-component-update', '--no-first-run']
    manifest.environment.args = args
    browser = await within(chromium.launch({ executablePath: edge, headless: true, args }), 'hardware browser startup')
    manifest.environment.browserVersion = browser.version()
    for (const [index, source] of manifest.order.entries()) {
      handler = staticHandler(sites[source])
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'no-preference', serviceWorkers: 'block' })
      const sample = { index, source, captures: [], network: [] }, inflight = new Set()
      manifest.samples.push(sample)
      try {
        const record = value => { if (manifest.ledger.length < 128) manifest.ledger.push({ index, source, ...value }); else manifest.ledgerOverflow = true }
        await guardContext(context, { origin: ORIGIN, mode: 'mock-browser' }, url => record({ kind: 'blocked', url }))
        sample.requests = 0
        context.on('request', request => { inflight.add(request); if (++sample.requests > 1024) record({ kind: 'network-budget' }) })
        context.on('requestfinished', request => inflight.delete(request))
        context.on('requestfailed', request => { inflight.delete(request); record({ kind: 'requestfailed', url: request.url(), error: request.failure()?.errorText }) })
        context.on('response', response => { if (sample.network.length < 1024) sample.network.push({ url: response.url(), status: response.status() }); if (response.status() >= 300) record({ kind: 'http', url: response.url(), status: response.status() }) })
        await context.addInitScript(installProbe, { clock: CLOCK, captureBytes: LIMITS.captureBytes })
        const page = await context.newPage()
        page.setDefaultTimeout(15000)
        page.on('pageerror', error => record({ kind: 'pageerror', message: error.message }))
        page.on('console', message => { if (message.type() === 'error') record({ kind: 'console-error', message: message.text() }) })
        page.on('crash', () => record({ kind: 'crash' }))
        await page.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 15000 })
        await page.locator('main').waitFor({ state: 'visible' })
        await page.locator('canvas.ghost-fibers-canvas').waitFor({ state: 'visible' })
        if (await page.locator('canvas.ghost-fibers-canvas').count() !== 1 || await page.locator('canvas').count() < 2) throw Error('Real whole-home radar/GhostFibers canvases required')
        const step = async count => {
          for (let i = 0; i < count; i++) {
            await page.evaluate(() => window.__homePixels.step())
            // Yield real browser I/O/observer delivery, without changing virtual time.
            await page.waitForTimeout(10)
            if (manifest.ledger.length) throw Error('Fail-closed runtime/network ledger is nonempty')
          }
        }
        // Start the EXISTING normal-scroll precondition concurrently with clock
        // progress: awaiting it first would deadlock its requestAnimationFrame.
        let readinessError
        const readiness = page.evaluate(warmHomepageImages).then(() => page.evaluate(async () => {
          await document.fonts.ready
          await Promise.all([...document.images].map(image => image.decode()))
          return { fonts: document.fonts.status, images: [...document.images].map(image => ({ src: image.currentSrc || image.src, complete: image.complete, width: image.naturalWidth })) }
        })).catch(error => { readinessError = error; return null })
        await within(step(CLOCK.readinessFrames), 'fixed readiness clock traversal', 45000)
        sample.readiness = await within(readiness, 'normal-scroll images/fonts readiness')
        if (readinessError) throw readinessError
        if (inflight.size || sample.readiness.fonts !== 'loaded' || sample.readiness.images.some(image => !image.complete || !image.width)) throw Error('Unsettled whole-home images/fonts/requests')
        await within(step(CLOCK.settleFrames), 'fixed post-readiness frames', 30000)
        sample.gpu = hardwareGPU(await page.evaluate(() => window.__homePixels.info().gpu))
        if (!/5700\s*XT/i.test(sample.gpu.unmaskedRenderer)) throw Error('Expected physical RX 5700 XT renderer')
        if (index && JSON.stringify(sample.gpu) !== JSON.stringify(manifest.samples[0].gpu)) throw Error('GPU identity changed between independent contexts')
        for (const state of STATES) {
          if (state.startsWith('pointer-')) {
            const rect = await page.locator('.ghost-fibers-container').boundingBox()
            if (!rect || rect.width <= 0 || rect.height <= 0) throw Error('Missing GhostFibers pointer geometry')
            const x = rect.x + rect.width * (state === 'pointer-left' ? 0.25 : 0.75), y = rect.y + rect.height * 0.4
            await page.mouse.move(x, y)
            if (state === 'pointer-right-pulse') {
              // A window pointer event avoids navigation/activation of homepage controls.
              await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true })), { x, y })
            }
          }
          if (state === 'visibility-return') {
            await page.evaluate(() => window.__homePixels.visibility(true))
            const before = await page.evaluate(() => window.__homePixels.info().finalDraws)
            await within(step(3), 'hidden clock steps')
            if (await page.evaluate(() => window.__homePixels.info().finalDraws) !== before) throw Error('GhostFibers drew while document hidden')
            await page.evaluate(() => window.__homePixels.visibility(false))
          }
          await within(step(CLOCK.stateFrames), `${state} fixed frames`, 30000)
          await page.evaluate(state => window.__homePixels.arm(state), state)
          await step(1)
          const capture = await page.evaluate(() => window.__homePixels.take())
          const bytes = Buffer.from(capture.rgbaBase64, 'base64')
          delete capture.rgbaBase64
          if (bytes.length !== capture.width * capture.height * 4 || bytes.length > LIMITS.captureBytes) throw Error('Malformed framebuffer payload')
          capture.sha256 = hash(bytes)
          capture.file = `${index}-${source}-${state}.rgba`
          sample.captures.push(capture)
          await fs.writeFile(path.join(output, capture.file), bytes, { flag: 'wx' })
          await artifactBudget(output)
        }
        sample.probe = await page.evaluate(() => window.__homePixels.info())
        if (JSON.stringify(hardwareGPU(sample.probe.gpu)) !== JSON.stringify(sample.gpu)) throw Error('GPU identity changed during capture')
        // Compare the actual application DOM, not Vite's necessarily different
        // hashed module-script URLs in the surrounding build shell.
        sample.domSha256 = hash(await page.locator('#root').innerHTML())
        sample.canvasDimensions = await page.locator('canvas').evaluateAll(canvases => canvases.map(canvas => ({ className: canvas.className, width: canvas.width, height: canvas.height })))
        if (inflight.size || manifest.ledger.length || sample.probe.failures.length) throw Error('Unsettled or failed GPU capture run')
      } finally {
        sample.inflight = [...inflight].map(request => request.url())
        await within(context.close(), 'independent context teardown')
      }
    }
    const signature = sample => JSON.stringify({ captures: sample.captures.map(({ file, ...capture }) => capture), gpu: sample.gpu, domSha256: sample.domSha256, canvasDimensions: sample.canvasDimensions })
    manifest.baselineRepeatExact = signature(manifest.samples[0]) === signature(manifest.samples[1])
    manifest.candidateExact = signature(manifest.samples[0]) === signature(manifest.samples[2])
    if (!manifest.baselineRepeatExact) throw Error('INCONCLUSIVE_FAIL: baseline-repeat output/DOM/frame metadata not exact; raw hashes retained')
    if (!manifest.candidateExact) throw Error('INCONCLUSIVE_FAIL: candidate output/DOM/frame metadata not exact; no tolerance or automatic acceptance')
    manifest.status = 'EXACT_MATCH_REVIEW_REQUIRED'
  } catch (error) { manifest.failure = { name: error.name, message: error.message }; throw error }
  finally {
    const finalize = async work => {
      try { await work() }
      catch (error) {
        manifest.status = 'INCONCLUSIVE_FAIL'
        manifest.finalizationFailures ??= []
        manifest.finalizationFailures.push({ name: error.name, message: error.message })
        process.exitCode = 1
      }
    }
    await finalize(async () => { if (browser) await within(browser.close(), 'browser teardown') })
    await finalize(async () => {
      if (server) { server.closeAllConnections(); await within(new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())), 'server teardown') }
    })
    await finalize(async () => {
      for (const [name, root] of Object.entries({ baseline, candidate })) if (JSON.stringify(await sourceIdentity(root)) !== JSON.stringify(sources[name])) throw Error(`${name} frontend source identity changed during run`)
      if (JSON.stringify(await dependencyIdentity()) !== JSON.stringify(dependencies)) throw Error('Dependency identity changed during run')
      if (hash(await fs.readFile(edge)) !== manifest.environment.edgeSha256) throw Error('Browser executable identity changed during run')
      manifest.sourceIdentityUnchanged = true
      manifest.artifacts = await artifactBudget(output)
    })
    await save(path.join(output, 'home-output-pixels.json'), manifest)
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
