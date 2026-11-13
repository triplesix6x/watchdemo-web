// Ownership census, not a timing benchmark. No application code is changed.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
const info = JSON.parse(execFileSync('docker', ['inspect', 'watchdemo-local-frontend-1'], { encoding: 'utf8' }))[0]
assert.equal(info.Config.Labels['com.docker.compose.project'], 'watchdemo-local')
assert.equal(Object.keys(info.NetworkSettings.Networks).length, 1)
assert(info.HostConfig.Memory > 0 && info.HostConfig.NanoCpus > 0)
assert(Object.values(info.NetworkSettings.Ports ?? {}).every(value => value === null))
const ip = Object.values(info.NetworkSettings.Networks)[0].IPAddress
assert.match(ip, /^172\.\d+\.\d+\.\d+$/)
const origin = `https://${ip}:8443`
const domMode = process.env.QA_DOM_COMMITS
assert(domMode === undefined || ['on', 'off'].includes(domMode))
const productionSurface = process.env.QA_PRODUCTION_SURFACE === '1'
const surfaceMode = process.env.QA_SURFACE
assert(surfaceMode === undefined || ['original', 'flat', 'stage', 'background'].includes(surfaceMode))
assert(!(domMode && surfaceMode))
assert(!productionSurface || (!domMode && !surfaceMode))
const variant = surfaceMode ? 'surface' : 'dom-commit'
const diagnosticPath = surfaceMode ? '/__home-diagnostic-20261113-surface/surface/' + (['stage', 'background'].includes(surfaceMode) ? 'split.html' : 'index.html') : '/__home-diagnostic-20261113-dom/dom-commit/index.html'
const url = surfaceMode ? `${origin}${diagnosticPath}?surface=${surfaceMode}` : domMode ? `${origin}${diagnosticPath}?domCommits=${domMode}` : origin
const output = process.env.QA_OUTPUT_DIR
assert(output?.startsWith('/home/bigboss/.local/share/watchdemo-invalidation-'))
await mkdir(output)
const browser = await chromium.launch({ headless: false, executablePath: '/home/bigboss/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' })
const errors = [], rejected = [], results = []
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, serviceWorkers: 'block' })
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { rejected.push(route.request().url()); return route.abort() }
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url, { waitUntil: 'networkidle' })
  if (domMode || surfaceMode) {
    for (let reload = 0; reload < 2; reload++) {
      await page.waitForFunction(({ variant, domMode, surfaceMode }) => document.documentElement.dataset.localDiagnostic === variant && (surfaceMode ? document.documentElement.dataset.localSurface === surfaceMode : document.documentElement.dataset.localDomCommits === domMode), { variant, domMode, surfaceMode })
      assert.equal(page.url(), url)
      assert((await page.locator('script[type="module"]').getAttribute('src')).startsWith(diagnosticPath.slice(0, diagnosticPath.lastIndexOf('/') + 1) + 'assets/'))
      assert((await page.locator('[data-diagnostic-badge]').textContent()).includes(surfaceMode ? `skin=${surfaceMode}` : `commits=${domMode}`))
      if (reload === 0) await page.reload({ waitUntil: 'networkidle' })
    }
  }
  await page.locator('.radar-canvas').waitFor()
  await page.waitForTimeout(3500)
  const surface = await page.evaluate(() => {
    const stage = document.querySelector('.story-stage'), background = document.querySelector('.home-background'), effect = document.querySelector('.home-background-effect')
    const rect = stage.getBoundingClientRect(), canvas = document.querySelector('.radar-canvas')
    return { stage: { width: rect.width, height: rect.height, top: rect.top }, backdrop: getComputedStyle(stage).backdropFilter, mask: getComputedStyle(background).maskImage, opacity: getComputedStyle(effect).opacity, canvas: [canvas.width, canvas.height], backgroundCanvas: !!effect.querySelector('canvas'), module: document.querySelector('script[type="module"]').getAttribute('src') }
  })
  if (productionSurface) {
    assert.equal(new URL(page.url()).pathname, '/')
    assert(surface.backgroundCanvas)
    assert.equal(surface.backdrop, 'none')
    assert.equal(surface.mask, 'none')
    assert.equal(surface.opacity, '1')
    assert.equal(await page.locator('[data-diagnostic-badge]').count(), 0)
    assert.equal(await page.locator('.radar-canvas').evaluate(canvas => getComputedStyle(canvas).maskImage), 'none')
  }
  if (surfaceMode) {
    assert(surface.backgroundCanvas)
    if (['flat', 'stage'].includes(surfaceMode)) assert.equal(surface.backdrop, 'none')
    else assert(surface.backdrop.includes('blur(12px)'))
    if (['flat', 'background'].includes(surfaceMode)) { assert.equal(surface.mask, 'none'); assert.equal(surface.opacity, '1') }
    else { assert(surface.mask.includes('gradient')); assert.equal(surface.opacity, '0.6') }
  }
  await page.evaluate(() => {
    const counters = { mutations: {}, geometryReads: {} }
    const identity = element => element?.nodeType === 1
      ? element.tagName.toLowerCase() + (element.classList?.length ? '.' + [...element.classList].join('.') : '')
      : '#text'
    const increment = (target, key) => { target[key] = (target[key] || 0) + 1 }
    const nativeRect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (...args) {
      increment(counters.geometryReads, identity(this))
      return nativeRect.apply(this, args)
    }
    const observer = new MutationObserver(records => {
      for (const record of records) increment(counters.mutations, identity(record.target) + ':' + (record.attributeName || record.type))
    })
    observer.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true })
    window.__takeInvalidationCensus = () => {
      const result = {
        scrollY,
        radar: window.__localDomCensus ? structuredClone(window.__localDomCensus) : null,
        counters: structuredClone(counters),
        animations: document.getAnimations().filter(animation => animation.playState === 'running').map(animation => ({
          target: identity(animation.effect?.target),
          properties: [...new Set(animation.effect?.getKeyframes().flatMap(frame => Object.keys(frame).filter(key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))))],
        })),
      }
      counters.mutations = {}
      counters.geometryReads = {}
      return result
    }
  })
  const take = async phase => results.push({ phase, ...(await page.evaluate(() => window.__takeInvalidationCensus())) })
  await page.waitForTimeout(2000)
  await take('idle')
  for (let i = 0; i < 24; i++) { await page.mouse.wheel(0, 130); await page.waitForTimeout(60) }
  await page.waitForTimeout(300)
  await take('scroll-down')
  for (let i = 0; i < 24; i++) { await page.mouse.wheel(0, -130); await page.waitForTimeout(60) }
  // Wheel deltas are symmetric, but Lenis has not necessarily settled after 300 ms.
  await page.waitForFunction(() => scrollY < 2, { timeout: 8000 })
  await take('scroll-up')
  await page.waitForTimeout(2000)
  await take('returned-idle')
  assert(results.find(result => result.phase === 'scroll-down').scrollY > 100)
  assert(results.find(result => result.phase === 'scroll-up').scrollY < 2)
  if (domMode || surfaceMode) {
    const first = results[0].radar, last = results.at(-1).radar
    assert(first && last)
    assert(last.draws > first.draws + 50, 'Original radar must continue drawing')
    assert.equal(last.draws, last.ticks)
    assert(last.attempted > first.attempted + 100)
    if (domMode === 'off') {
      assert.equal(last.committed, 0)
      for (const result of results) assert(!Object.keys(result.counters.mutations).some(key => /radar-(rail|fill|clock).*:|aria-valuenow|aria-valuetext/.test(key)), 'Quarantined timeline must have zero mutations')
    } else assert.equal(last.committed, last.attempted)
  }
  if (productionSurface) {
    const slider = page.getByRole('slider')
    await slider.focus()
    await slider.press('End')
    await page.waitForFunction(() => document.querySelector('[role="slider"]').getAttribute('aria-valuenow') === '75')
    await slider.press('Home')
    await page.waitForFunction(() => scrollY < 2)
    for (const width of [375, 1280, 1920, 2560]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 1080 })
      await page.waitForTimeout(600)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`)
      await page.screenshot({ path: `${output}/home-${width}.png` })
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    assert.equal(await page.locator('.home-background-effect canvas').count(), 0)
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(rejected, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ acceptingPerformance: false, url, domMode, surfaceMode, surface, results, errors, rejected }, null, 2))
  console.log(JSON.stringify({ output, phases: results.map(result => ({ phase: result.phase, radar: result.radar, mutations: Object.entries(result.counters.mutations).sort((a, b) => b[1] - a[1]).slice(0, 8), geometryReads: result.counters.geometryReads, animations: result.animations })) }, null, 2))
} finally { await browser.close() }
