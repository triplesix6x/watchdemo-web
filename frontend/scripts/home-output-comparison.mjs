// Whole production homepage, separately built OLD/NEW source graphs. Real hardware
// rAF only; no component suppression, shader tuning, virtual clock or pixel tolerance.
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
import { WORKLOAD, sampleOrder, hardwareGPU, summarize, warmHomepageImages } from './home-output-comparison-contract.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim()
const save = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
async function within(promise, label, ms = 15000) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), ms) })]) }
  finally { clearTimeout(timer) }
}
async function sourceIdentity(root) {
  const files = git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '--', 'frontend').split('\n').filter(Boolean).sort()
  const hashes = {}
  for (const file of files) {
    if (/(^|\/)\.env(?:\.|$)/.test(file)) continue
    hashes[file] = hash(await fs.readFile(path.join(root, file)))
  }
  return { root, head: git(root, 'rev-parse', 'HEAD'), status: git(root, 'status', '--short', '--', 'frontend'), hashes, sha256: hash(JSON.stringify(hashes)) }
}
async function main() {
  const { values: a } = parseArgs({ options: Object.fromEntries(['baseline-root', 'candidate-root', 'deps-root', 'edge', 'output', 'repeats'].map(key => [key, { type: 'string' }])) })
  const order = sampleOrder(Number(a.repeats))
  for (const key of ['baseline-root', 'candidate-root', 'deps-root', 'edge']) if (!a[key] || !path.isAbsolute(a[key])) throw Error(`Explicit absolute --${key} required; no install/discovery`)
  const baseline = await fs.realpath(a['baseline-root']), candidate = await fs.realpath(a['candidate-root'])
  disjointDirectories(baseline, candidate)
  const deps = await fs.realpath(a['deps-root']), edge = await fs.realpath(a.edge)
  const sources = { baseline: await sourceIdentity(baseline), candidate: await sourceIdentity(candidate) }
  if (sources.baseline.status) throw Error('Baseline frontend must be clean and immutable for comparison')
  const packageBytes = await fs.readFile(path.join(candidate, 'frontend/package.json'))
  for (const root of [baseline, deps]) {
    const packageFile = root === baseline ? path.join(root, 'frontend/package.json') : path.join(root, 'package.json')
    if (!packageBytes.equals(await fs.readFile(packageFile))) throw Error('Source/dependency package manifests must match')
  }
  const lock = await fs.readFile(path.join(deps, 'package-lock.json'))
  for (const root of [baseline, candidate]) if (!lock.equals(await fs.readFile(path.join(root, 'frontend/package-lock.json')))) throw Error('Source/dependency lockfiles must match')
  const output = await externalDirectory(a.output, { fresh: true })
  for (const root of [baseline, candidate, deps]) disjointDirectories(root, output)
  const require = createRequire(path.join(deps, 'package.json'))
  const { build } = await import(pathToFileURL(path.join(path.dirname(require.resolve('vite/package.json')), 'dist/node/index.js')).href)
  const { chromium } = require('playwright-core')
  const dependencyManifests = {}
  for (const name of [...Object.keys(JSON.parse(packageBytes).dependencies), 'vite', 'playwright-core', 'typescript']) {
    const bytes = await fs.readFile(path.join(deps, 'node_modules', name, 'package.json'))
    dependencyManifests[name] = { version: JSON.parse(bytes).version, sha256: hash(bytes) }
  }
  const args = ['--disable-background-networking', '--disable-component-update', '--no-first-run']
  const manifest = { version: 1, accepting: false, workload: WORKLOAD, order, sources,
    environment: { node: process.version, os: { platform: os.platform(), release: os.release(), arch: os.arch() }, origin: ORIGIN, edge, edgeSha256: hash(await fs.readFile(edge)), args, clock: 'real rAF; no virtual clock', cpuAccounting: 'CDP Performance threadTicks main-thread task/script/layout durations; not whole-process or GPU time', lockSha256: hash(lock), dependencyManifests },
    samples: [], ledger: [], conclusion: 'Incomplete; not acceptance or a measured speedup' }
  let browser, server
  let handler = (_request, response) => response.writeHead(503).end()
  try {
    const sites = {}
    for (const [name, root] of Object.entries({ baseline, candidate })) {
      const buildRoot = path.join(output, name)
      await fs.mkdir(buildRoot)
      await fs.mkdir(path.join(buildRoot, 'site'))
      const config = staticBuildConfig(path.join(root, 'frontend'), deps, buildRoot, Object.keys(JSON.parse(packageBytes).dependencies))
      // Only the real homepage entry is needed. Both sides keep their OWN complete
      // application/dependency import graph; no old-driver/new-helper hybrid.
      config.build.rollupOptions.input = { site: path.join(root, 'frontend/index.html') }
      await within(build(config), `${name} production build`, 60000)
      sites[name] = await fs.realpath(path.join(buildRoot, 'site'))
    }
    server = createServer((request, response) => handler(request, response))
    server.on('upgrade', (_request, socket) => socket.destroy())
    await within(new Promise((resolve, reject) => { server.once('error', reject); server.listen(55450, '127.0.0.1', resolve) }), 'owned exact-origin static listener')
    browser = await within(chromium.launch({ executablePath: edge, headless: true, args }), 'hardware browser startup')
    manifest.environment.browserVersion = browser.version()
    for (const entry of order) {
      handler = staticHandler(sites[entry.source])
      const context = await browser.newContext({ viewport: { width: WORKLOAD.width, height: WORKLOAD.height }, deviceScaleFactor: WORKLOAD.dpr, locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'no-preference', serviceWorkers: 'block' })
      const sample = { ...entry, inflight: [], network: [] }
      const inflight = new Set()
      try {
        await guardContext(context, { origin: ORIGIN, mode: 'mock-browser' }, url => manifest.ledger.push({ ...entry, kind: 'blocked', url }))
        context.on('request', request => inflight.add(request))
        context.on('requestfinished', request => inflight.delete(request))
        context.on('requestfailed', request => { inflight.delete(request); manifest.ledger.push({ ...entry, kind: 'requestfailed', url: request.url(), error: request.failure()?.errorText }) })
        context.on('response', response => { sample.network.push({ url: response.url(), status: response.status() }); if (response.status() >= 400) manifest.ledger.push({ ...entry, kind: 'http', status: response.status(), url: response.url() }) })
        await context.addInitScript(({ seed }) => {
          localStorage.setItem('wd-mock-user', 'anon'); localStorage.setItem('wd-mock-delay', '280')
          let state = seed
          Math.random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296 }
          crypto.randomUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16) })
        }, WORKLOAD)
        const page = await context.newPage()
        page.setDefaultTimeout(15000)
        page.on('pageerror', error => manifest.ledger.push({ ...entry, kind: 'pageerror', message: error.message }))
        page.on('console', message => { if (message.type() === 'error') manifest.ledger.push({ ...entry, kind: 'console-error', message: message.text() }) })
        await page.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 15000 })
        sample.readinessBefore = await within(page.evaluate(() => ({ fonts: document.fonts.status, images: [...document.images].map(image => ({ src: image.currentSrc || image.src, loading: image.loading, complete: image.complete, width: image.naturalWidth })) })), 'readiness state')
        await within(page.evaluate(warmHomepageImages), 'normal-scroll lazy-image preconditioning')
        await within(page.evaluate(() => document.fonts.ready.then(() => null)), 'fonts')
        await within(page.evaluate(() => Promise.all([...document.images].map(image => image.decode()))), 'images')
        if (inflight.size) throw Error('Homepage readiness has unfinished HTTP requests')
        await page.locator('main').waitFor({ state: 'visible' })
        if (await page.locator('canvas').count() < 2) throw Error('Whole-home radar/background canvases missing')
        sample.gpu = hardwareGPU(await page.evaluate(() => {
          const gl = document.createElement('canvas').getContext('webgl2')
          if (!gl) return null
          const ext = gl.getExtension('WEBGL_debug_renderer_info')
          const result = { renderer: gl.getParameter(gl.RENDERER), unmaskedRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null }
          gl.getExtension('WEBGL_lose_context')?.loseContext()
          return result
        }))
        if (manifest.samples.length && JSON.stringify(manifest.samples[0].gpu) !== JSON.stringify(sample.gpu)) throw Error('GPU identity changed between samples')
        await page.waitForTimeout(WORKLOAD.warmupMs)
        const cdp = await context.newCDPSession(page)
        try {
          await cdp.send('Performance.enable', { timeDomain: 'threadTicks' })
          const readCPU = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
          const cpuBefore = await readCPU()
          sample.frames = await within(page.evaluate(async workload => {
            const frames = [], longTasks = [], longAnimationFrames = [], observers = []
            for (const [type, target] of [['longtask', longTasks], ['long-animation-frame', longAnimationFrames]]) {
              if (PerformanceObserver.supportedEntryTypes.includes(type)) {
                const observer = new PerformanceObserver(list => target.push(...list.getEntries().map(e => ({ startTime: e.startTime, duration: e.duration }))))
                observer.observe({ type }); observers.push(observer)
              }
            }
            const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight)
            let start, previous
            try {
              await new Promise(resolve => {
                const frame = now => {
                  start ??= now
                  const elapsed = now - start, phase = Math.min(3, Math.floor(elapsed / workload.phaseMs))
                  const progress = Math.min(1, (elapsed - phase * workload.phaseMs) / workload.phaseMs)
                  const y = phase === 0 ? 0 : phase === 1 ? maxScroll * progress : phase === 2 ? maxScroll : maxScroll * (1 - progress)
                  window.scrollTo({ top: y, behavior: 'instant' })
                  if (previous !== undefined) frames.push({ elapsed, deltaMs: now - previous, phase: workload.phases[phase], scrollY })
                  previous = now
                  if (elapsed >= workload.phaseMs * workload.phases.length) resolve()
                  else requestAnimationFrame(frame)
                }
                requestAnimationFrame(frame)
              })
              // Flush observer delivery without extending the measured frame loop.
              await new Promise(resolve => setTimeout(resolve, 0))
              return { frames, longTasks, longAnimationFrames, supportedEntries: PerformanceObserver.supportedEntryTypes, maxScroll, canvases: [...document.querySelectorAll('canvas')].map(c => ({ width: c.width, height: c.height })) }
            } finally { observers.forEach(observer => observer.disconnect()) }
          }, WORKLOAD), 'finite realtime whole-home workload', 15000)
          const cpuAfter = await readCPU()
          const sorted = sample.frames.frames.map(f => f.deltaMs).sort((a, b) => a - b)
          if (!sorted.length || sample.frames.maxScroll <= 0) throw Error('Empty or non-scrollable homepage workload')
          const delta = name => { if (!Number.isFinite(cpuBefore[name]) || !Number.isFinite(cpuAfter[name])) throw Error(`Missing CDP CPU metric ${name}`); return (cpuAfter[name] - cpuBefore[name]) * 1000 }
          sample.metrics = { p50FrameMs: sorted[Math.floor((sorted.length - 1) * .5)], p95FrameMs: sorted[Math.floor((sorted.length - 1) * .95)], longFrames: sorted.filter(t => t > 50).length,
            taskDurationMs: delta('TaskDuration'), scriptDurationMs: delta('ScriptDuration'), layoutDurationMs: delta('LayoutDuration'), recalcStyleDurationMs: delta('RecalcStyleDuration') }
        } finally { await cdp.detach() }
        if (manifest.ledger.length) throw Error('Fail-closed network/runtime ledger is nonempty')
        manifest.samples.push(sample)
      } finally {
        sample.inflight = [...inflight].map(request => request.url())
        if (!manifest.samples.includes(sample)) manifest.samples.push(sample)
        await within(context.close(), 'context teardown')
      }
    }
    for (const [name, root] of Object.entries({ baseline, candidate })) if (JSON.stringify(await sourceIdentity(root)) !== JSON.stringify(sources[name])) throw Error(`${name} source changed during comparison`)
    manifest.summary = summarize(manifest.samples)
    manifest.conclusion = manifest.summary.conclusion
  } catch (error) { manifest.failure = { name: error.name, message: error.message }; throw error }
  finally {
    try { if (browser) await within(browser.close(), 'browser teardown') }
    finally {
      try { if (server) { server.closeAllConnections(); await within(new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())), 'server teardown') } }
      finally { await save(path.join(output, 'home-output-comparison.json'), manifest) }
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
