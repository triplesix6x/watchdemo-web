// Behavioural verification only, not a performance benchmark.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
const container = JSON.parse(execFileSync('docker', ['inspect', 'watchdemo-local-frontend-1'], { encoding: 'utf8' }))[0]
assert.equal(container.Config.Labels['com.docker.compose.project'], 'watchdemo-local')
assert.equal(Object.keys(container.NetworkSettings.Networks).length, 1)
assert(container.HostConfig.Memory > 0 && container.HostConfig.NanoCpus > 0)
assert(Object.values(container.NetworkSettings.Ports ?? {}).every(value => value === null))
const ip = Object.values(container.NetworkSettings.Networks)[0].IPAddress
assert.match(ip, /^172\.\d+\.\d+\.\d+$/)
const origin = `https://${ip}:8443`
const output = process.env.QA_OUTPUT_DIR
assert(output?.startsWith('/home/bigboss/.local/share/watchdemo-site-qa-'))
await mkdir(output)
const browser = await chromium.launch({ headless: false, executablePath: '/home/bigboss/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' })
const results = [], rejected = [], errors = []
try {
  const blockOff = process.env.QA_RADAR_BLOCK_OFF === '1'
  const maskOff = process.env.QA_RADAR_MASK_OFF === '1'
  const staticReference = process.env.QA_STATIC_REFERENCE === '1'
  assert([blockOff, maskOff, staticReference].filter(Boolean).length <= 1)
  const directory = blockOff ? '__home-diagnostic-20261112-block-off' : maskOff ? '__home-diagnostic-20261112-mask-off' : staticReference ? '__home-diagnostic-20261112-static' : '__home-diagnostic-20261112'
  for (const variant of blockOff ? ['radar-block-off'] : maskOff ? ['radar-mask-off'] : staticReference ? ['static-reference'] : ['normal', 'blur-off', 'radar-off', 'background-off', 'native-scroll']) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'no-preference', serviceWorkers: 'block' })
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { rejected.push(route.request().url()); return route.abort() }
      return route.continue()
    })
    await context.addInitScript(() => {
      window.__diagnosticDraws = 0
      const clear = CanvasRenderingContext2D.prototype.clearRect
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        if (this.canvas.classList.contains('radar-canvas')) window.__diagnosticDraws++
        return clear.apply(this, args)
      }
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push({ variant, error: error.message }))
    assert.equal((await page.goto(`${origin}/${directory}/${variant}/index.html`, { waitUntil: 'networkidle' })).status(), 200)
    await page.locator(blockOff ? '.hero-title' : '.story-stage .radar-canvas').waitFor()
    await page.waitForTimeout(3000)
    const initial = await page.evaluate(() => {
      const stage = document.querySelector('.story-stage')
      const rect = stage?.getBoundingClientRect()
      return { route: location.pathname, search: location.search, blur: stage ? getComputedStyle(stage).backdropFilter : null, smooth: document.documentElement.classList.contains('lenis'), draws: window.__diagnosticDraws,
        radarElements: document.querySelectorAll('.radar, .radar-canvas, .radar-track, .story-stage').length,
        mask: document.querySelector('.radar-canvas') ? getComputedStyle(document.querySelector('.radar-canvas')).maskImage : null,
        backgroundCanvases: document.querySelectorAll('.home-background canvas').length, geometry: rect ? { width: rect.width, height: rect.height, top: rect.top } : null, overflow: document.documentElement.scrollWidth - innerWidth }
    })
    assert.equal(initial.route, staticReference ? `/${directory}/static-reference/index.html` : '/')
    assert.equal(initial.search, staticReference ? '' : `?localDiagnostic=${variant}`)
    if (blockOff) {
      assert.equal(initial.radarElements, 0)
      assert.equal(initial.geometry, null)
      assert.equal(initial.blur, null)
    } else assert.equal(initial.blur === 'none', staticReference || variant === 'blur-off')
    assert.equal(initial.smooth, !staticReference && variant !== 'native-scroll')
    assert.equal(initial.draws > 0, !staticReference && !blockOff && variant !== 'radar-off')
    assert.equal(initial.backgroundCanvases > 0, !staticReference && variant !== 'background-off')
    if (maskOff || staticReference) assert.equal(initial.mask, 'none')
    if (staticReference) {
      const control = JSON.parse(await readFile('/home/bigboss/.local/share/watchdemo-site-qa-diagnostics-01/result.json', 'utf8'))
      assert.deepEqual(initial.geometry, control.results.find(result => result.variant === 'normal').initial.geometry)
      assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length), 0)
    }
    assert(initial.overflow <= 1)
    if (results.length) assert.deepEqual(initial.geometry, results[0].initial.geometry)
    await page.mouse.move(400, 500)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(1200)
    assert(await page.evaluate(() => scrollY > 100), `${variant}: input did not scroll`)
    await page.screenshot({ path: `${output}/${variant}.png` })
    results.push({ variant, initial, afterScroll: await page.evaluate(() => ({ scrollY, draws: window.__diagnosticDraws })) })
    await context.close()
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(rejected, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ acceptingPerformance: false, origin, results, errors, rejected }, null, 2))
  console.log(JSON.stringify({ variants: results.length, errors, rejected, output }))
} finally { await browser.close() }
