// NON-accepting attribution harness. Suppressions exist only in isolated builds.
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
import { ORIGIN, externalDirectory, disjointDirectories } from './refactor-web-qa-contract.mjs'
import { guardContext } from './qa-safety.mjs'
import { warmHomepageImages } from './home-output-comparison-contract.mjs'
import { VARIANTS, diagnosticTransform, frameSummary, orderSamples, offscreenStatus } from './home-scroll-diagnostic-contract.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
async function bounded(promise, label, ms = 20000) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), ms) })]) }
  finally { clearTimeout(timer) }
}
async function identity(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim()
  const files = git('ls-files', '--cached', '--others', '--exclude-standard', '--', 'frontend').split('\n').filter(f => f && !/(^|\/)\.env(?:\.|$)/.test(f)).sort()
  const hashes = {}
  for (const file of files) hashes[file] = hash(await fs.readFile(path.join(root, file)))
  return { root, head: git('rev-parse', 'HEAD'), status: git('status', '--short', '--', 'frontend'), sha256: hash(JSON.stringify(hashes)), hashes }
}
function initializeProbe() {
  localStorage.setItem('wd-mock-user', 'anon')
  localStorage.setItem('wd-mock-delay', '280')
  let seed = 240621
  Math.random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296 }
  const state = { frames: [], longtasks: [], loaf: [], previous: null, observers: [], active: true }
  for (const [type, list] of [['longtask', state.longtasks], ['long-animation-frame', state.loaf]]) {
    if (PerformanceObserver.supportedEntryTypes.includes(type)) {
      const observer = new PerformanceObserver(entries => list.push(...entries.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))))
      observer.observe({ type, buffered: true }); state.observers.push(observer)
    }
  }
  function frame(now) {
    if (!state.active) return
    if (state.previous !== null && state.frames.length < 20000) state.frames.push(now - state.previous)
    state.previous = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  window.__homeDiagnostic = state
}
async function takeProbe(page, reset = false) {
  return page.evaluate(reset => {
    const s = window.__homeDiagnostic
    // Flush observer records at the boundary, not at some later phase.
    s.observers.forEach((o, i) => {
      const list = o.takeRecords().map(e => ({ start: e.startTime, duration: e.duration }))
      const type = PerformanceObserver.supportedEntryTypes.includes('longtask') && i === 0 ? s.longtasks : s.loaf
      type.push(...list)
    })
    const result = { frames: s.frames, longtasks: s.longtasks, loaf: s.loaf, scrollY,
      stage: (() => { const r = document.querySelector('.story-stage')?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom, width: r.width, height: r.height, visible: r.bottom > 0 && r.top < innerHeight } : null })(),
      canvases: [...document.querySelectorAll('canvas')].map(c => ({ width: c.width, height: c.height, cssWidth: c.clientWidth, cssHeight: c.clientHeight })) }
    if (reset) { s.frames = []; s.longtasks = []; s.loaf = []; s.previous = null }
    return result
  }, reset)
}
async function main() {
  const strings = ['baseline-root', 'candidate-root', 'deps-root', 'chromium', 'output', 'repeats', 'variants', 'width', 'height', 'dpr', 'input', 'phase-ms']
  const { values: a } = parseArgs({ options: { ...Object.fromEntries(strings.map(k => [k, { type: 'string' }])), headful: { type: 'boolean', default: false } } })
  for (const k of ['baseline-root', 'candidate-root', 'deps-root', 'chromium', 'output']) if (!a[k] || !path.isAbsolute(a[k])) throw Error(`Explicit absolute --${k} required`)
  const width = Number(a.width ?? 390), height = Number(a.height ?? 844), dpr = Number(a.dpr ?? 1), phaseMs = Number(a['phase-ms'] ?? 2000)
  if (!Number.isInteger(width) || width < 320 || width > 3840 || !Number.isInteger(height) || height < 600 || height > 2160 || !Number.isFinite(dpr) || dpr < 1 || dpr > 3 || !Number.isInteger(phaseMs) || phaseMs < 1000 || phaseMs > 5000) throw Error('Viewport/DPR/phase bounds invalid')
  const input = a.input ?? 'wheel'
  if (!['wheel', 'touch'].includes(input)) throw Error('--input must be wheel or touch')
  const variants = (a.variants ?? VARIANTS.join(',')).split(',')
  if (new Set(variants).size !== variants.length || variants.some(v => !VARIANTS.includes(v))) throw Error('Invalid variant selection')
  const baseline = await fs.realpath(a['baseline-root']), candidate = await fs.realpath(a['candidate-root']), deps = await fs.realpath(a['deps-root'])
  disjointDirectories(baseline, candidate)
  const output = await externalDirectory(a.output, { fresh: true })
  for (const root of [baseline, candidate, deps]) disjointDirectories(root, output)
  const sources = { baseline: await identity(baseline), candidate: await identity(candidate) }
  if (sources.baseline.status) throw Error('Baseline frontend must be immutable and clean')
  const packageBytes = await fs.readFile(path.join(candidate, 'frontend/package.json'))
  const lock = await fs.readFile(path.join(deps, 'package-lock.json'))
  for (const root of [baseline, candidate]) {
    if (!packageBytes.equals(await fs.readFile(path.join(root, 'frontend/package.json'))) || !lock.equals(await fs.readFile(path.join(root, 'frontend/package-lock.json')))) throw Error('Dependency manifests/lock must match')
  }
  if (!packageBytes.equals(await fs.readFile(path.join(deps, 'package.json')))) throw Error('Installed dependency manifest mismatch')
  const require = createRequire(path.join(deps, 'package.json'))
  const { build } = await import(pathToFileURL(path.join(path.dirname(require.resolve('vite/package.json')), 'dist/node/index.js')).href)
  const { chromium } = require('playwright-core')
  const entries = [{ source: 'baseline', variant: 'normal', control: 'A1' }, ...variants.map(variant => ({ source: 'baseline', variant })), { source: 'candidate', variant: 'normal' }]
  const order = orderSamples(Number(a.repeats ?? 3), entries)
  const args = ['--disable-background-networking', '--disable-component-update', '--no-first-run']
  const report = { accepting: false, conclusion: 'Diagnostic only; rAF is scheduling, not presented FPS. No automated acceptance/speedup claim. Software GPU is not phone Safari.', sources, order,
    environment: { node: process.version, os: os.release(), chromium: a.chromium, chromiumSha256: hash(await fs.readFile(a.chromium)), headful: a.headful, args, width, height, dpr, input, phaseMs, lockSha256: hash(lock), cpuAccounting: 'CDP main-thread threadTicks, not whole-process or GPU time' }, samples: [], ledger: [] }
  let browser, server, handler = (_req, res) => res.writeHead(503).end()
  try {
    const sites = {}
    for (const entry of entries) {
      const key = `${entry.source}-${entry.variant}`
      if (sites[key]) continue
      const root = entry.source === 'baseline' ? baseline : candidate
      const buildRoot = path.join(output, key)
      await fs.mkdir(buildRoot)
      const config = staticBuildConfig(path.join(root, 'frontend'), deps, buildRoot, Object.keys(JSON.parse(packageBytes).dependencies))
      config.build.rollupOptions.input = { site: path.join(root, 'frontend/index.html') }
      config.plugins = [diagnosticTransform(entry.variant)]
      await bounded(build(config), `${key} isolated full-graph build`, 90000)
      sites[key] = await fs.realpath(path.join(buildRoot, 'site'))
    }
    server = createServer((req, res) => handler(req, res))
    server.on('upgrade', (_req, socket) => socket.destroy())
    await bounded(new Promise((resolve, reject) => { server.once('error', reject); server.listen(55450, '127.0.0.1', resolve) }), 'listener')
    browser = await bounded(chromium.launch({ executablePath: a.chromium, headless: !a.headful, args, timeout: 30000 }), 'browser launch', 35000)
    report.environment.browserVersion = browser.version()
    for (const entry of order) {
      handler = staticHandler(sites[`${entry.source}-${entry.variant}`])
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: input === 'touch', isMobile: input === 'touch', locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'no-preference', serviceWorkers: 'block' })
      const sample = { ...entry, phases: [] }
      report.samples.push(sample)
      try {
        await guardContext(context, { origin: ORIGIN, mode: 'mock-browser' }, url => report.ledger.push({ entry, blocked: url }))
        await context.addInitScript(initializeProbe)
        const page = await context.newPage()
        page.setDefaultTimeout(20000)
        page.on('pageerror', error => report.ledger.push({ entry, error: error.message }))
        page.on('console', msg => { if (msg.type() === 'error') report.ledger.push({ entry, console: msg.text() }) })
        page.on('response', res => { if (res.status() >= 400) report.ledger.push({ entry, status: res.status(), url: res.url() }) })
        const cdp = await context.newCDPSession(page)
        await cdp.send('Performance.enable', { timeDomain: 'threadTicks' })
        const cpu = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
        const coldCPU = await cpu(), coldStart = performance.now()
        await page.goto(ORIGIN, { waitUntil: 'load', timeout: 20000 })
        await page.locator('.radar canvas').waitFor({ state: 'visible' })
        if (entry.variant !== 'background-off') await page.locator('.home-background canvas').waitFor({ state: 'attached' })
        await bounded(page.evaluate(() => document.fonts.ready.then(() => null)), 'fonts')
        const coldAfter = await cpu()
        sample.cold = { elapsedMs: performance.now() - coldStart, ...await takeProbe(page, true), cpuBefore: coldCPU, cpuAfter: coldAfter }
        sample.gpu = await page.evaluate(() => {
          const gl = document.createElement('canvas').getContext('webgl2')
          if (!gl) return { available: false }
          const e = gl.getExtension('WEBGL_debug_renderer_info')
          const renderer = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
          const result = { available: true, renderer, vendor: gl.getParameter(gl.VENDOR), version: gl.getParameter(gl.VERSION), software: /swiftshader|software|llvmpipe|basic render|warp/i.test(renderer) }
          gl.getExtension('WEBGL_lose_context')?.loseContext()
          return result
        })
        await bounded(page.evaluate(warmHomepageImages), 'image preconditioning')
        await bounded(page.evaluate(() => Promise.all([...document.images].map(i => i.decode()))), 'image decode')
        await page.waitForTimeout(2000)
        sample.geometry = await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scale: visualViewport?.scale }, pageHeight: document.documentElement.scrollHeight, fonts: document.fonts.status, stage: (() => { const r = document.querySelector('.story-stage').getBoundingClientRect(); return { width: r.width, height: r.height } })(), radar: (() => { const r = document.querySelector('.radar').getBoundingClientRect(); return { width: r.width, height: r.height } })() }))
        const reference = report.samples[0].geometry
        if (reference && JSON.stringify(reference) !== JSON.stringify(sample.geometry)) throw Error('Geometry mismatch: performance must not be conflated with responsive changes')
        await page.mouse.move(width * .3, height * .35)
        async function scroll(distance) {
          if (input === 'wheel') await page.mouse.wheel(0, distance)
          else {
            // CDP dispatches a real touch sequence away from the timeline hit region.
            const x = Math.round(width * .08), from = distance > 0 ? height * .82 : height * .25
            const to = distance > 0 ? height * .25 : height * .82
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] })
            for (let i = 1; i <= 6; i++) {
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + (to - from) * i / 6 }] })
              await page.waitForTimeout(16)
            }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          }
        }
        const maximum = sample.geometry.pageHeight - height
        for (const phase of ['idle', 'down', 'offscreen', 'up', 'reentry']) {
          await takeProbe(page, true)
          const before = await cpu(), start = performance.now()
          if (phase === 'down' || phase === 'up') {
            const steps = input === 'touch' ? Math.ceil(maximum / (height * .45)) : 24
            for (let i = 0; i < steps; i++) {
              await scroll((phase === 'down' ? 1 : -1) * maximum / steps * 1.15)
              await page.waitForTimeout(Math.max(16, phaseMs / steps))
            }
            await page.waitForTimeout(400)
          } else await page.waitForTimeout(phaseMs)
          const after = await cpu(), data = await takeProbe(page, true)
          const cpuMs = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map(k => [k, Number.isFinite(before[k]) && Number.isFinite(after[k]) ? (after[k] - before[k]) * 1000 : null]))
          sample.phases.push({ phase, elapsedMs: performance.now() - start, ...data, frameSummary: frameSummary(data.frames), cpuMs })
          if (phase === 'offscreen') sample.offscreenEvidence = offscreenStatus({ width, scrollY: data.scrollY, maximum, stage: data.stage })
          if (phase === 'reentry' && data.scrollY > 10) throw Error('Real-input workload did not return to hero')
          // Screenshots are outside phase timing and never use canvas readback instrumentation.
          if (['idle', 'offscreen', 'reentry'].includes(phase)) await page.screenshot({ path: path.join(output, `${report.samples.length}-${entry.source}-${entry.variant}-${phase}.png`) })
        }
        await cdp.detach()
        if (report.ledger.length) throw Error('Network/runtime diagnostic ledger nonempty')
      } finally { await bounded(context.close(), 'context teardown') }
    }
    for (const [key, root] of Object.entries({ baseline, candidate })) if (JSON.stringify(await identity(root)) !== JSON.stringify(sources[key])) throw Error(`${key} changed during run`)
    report.complete = true
  } catch (error) { report.failure = error.message; throw error }
  finally {
    try { if (browser) await bounded(browser.close(), 'browser teardown') }
    finally {
      try { if (server) { server.closeAllConnections(); await bounded(new Promise(resolve => server.close(resolve)), 'server teardown') } }
      finally { await fs.writeFile(path.join(output, 'home-scroll-diagnostic.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }) }
    }
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1 })
