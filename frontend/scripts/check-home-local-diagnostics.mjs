// Behavioural verification only, not a performance benchmark.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { isolationVariants, compositionVariants } from './home-motion-isolation.mjs'
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
  const radarLayers = process.env.QA_RADAR_LAYERS === '1'
  const radarWebgl = process.env.QA_RADAR_WEBGL === '1'
  const rendererCandidate = radarLayers || radarWebgl
  const blockOff = process.env.QA_RADAR_BLOCK_OFF === '1'
  const maskOff = process.env.QA_RADAR_MASK_OFF === '1'
  const staticReference = process.env.QA_STATIC_REFERENCE === '1'
  const boundedMotion = process.env.QA_BOUNDED_MOTION === '1'
  const composeMotion = process.env.QA_COMPOSITION_ISOLATION === '1'
  const isolateMotion = process.env.QA_MOTION_ISOLATION === '1' || composeMotion
  assert([radarLayers, radarWebgl, blockOff, maskOff, staticReference, boundedMotion, isolateMotion].filter(Boolean).length <= 1)
  const directory = radarWebgl ? '__home-diagnostic-20261113-webgl' : radarLayers ? '__home-diagnostic-20261113-layers-v2' : composeMotion ? '__home-diagnostic-20261113-composition' : isolateMotion ? '__home-diagnostic-20261113-isolation' : boundedMotion ? '__home-diagnostic-20261112-bounded-motion' : blockOff ? '__home-diagnostic-20261112-block-off' : maskOff ? '__home-diagnostic-20261112-mask-off' : staticReference ? '__home-diagnostic-20261112-static' : '__home-diagnostic-20261112'
  for (const variant of radarWebgl ? ['radar-webgl'] : radarLayers ? ['radar-layers'] : composeMotion ? compositionVariants : isolateMotion ? isolationVariants : boundedMotion ? ['bounded-motion'] : blockOff ? ['radar-block-off'] : maskOff ? ['radar-mask-off'] : staticReference ? ['static-reference'] : ['normal', 'blur-off', 'radar-off', 'background-off', 'native-scroll']) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'no-preference', serviceWorkers: 'block' })
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { rejected.push(route.request().url()); return route.abort() }
      return route.continue()
    })
    await context.addInitScript(() => {
      window.__diagnosticDraws = 0
      const clear = CanvasRenderingContext2D.prototype.clearRect
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        if (this.canvas.classList.contains('radar-canvas') || this.canvas.classList.contains('radar-layer')) window.__diagnosticDraws++
        return clear.apply(this, args)
      }
      for (const method of ['drawArrays', 'drawArraysInstanced']) {
        const draw = WebGL2RenderingContext.prototype[method]
        WebGL2RenderingContext.prototype[method] = function (...args) {
          if (this.canvas.classList.contains('radar-canvas')) window.__diagnosticDraws++
          return draw.apply(this, args)
        }
      }
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push({ variant, error: error.message }))
    assert.equal((await page.goto(`${origin}/${directory}/${variant}/index.html`, { waitUntil: 'networkidle' })).status(), 200)
    await page.locator(blockOff ? '.hero-title' : '.story-stage .radar-canvas').waitFor()
    await page.waitForTimeout(3000)
    if (rendererCandidate) {
      for (let reload = 0; reload < 2; reload++) {
        await page.locator(`[data-diagnostic-badge="${variant}"]`).waitFor()
        assert.equal(new URL(page.url()).pathname, `/${directory}/${variant}/index.html`)
        assert.equal(await page.locator('.story-stage canvas.radar-layer').count(), radarLayers ? 37 : 0)
        assert.match(await page.locator('script[type="module"][src]').first().getAttribute('src'), new RegExp(`^/${directory}/`))
        await page.reload({ waitUntil: 'networkidle' })
      }
      await page.locator(`[data-diagnostic-badge="${variant}"]`).waitFor()
      await page.waitForTimeout(3000) // Let the normal 1.9 s intro settle after the last reload.
    }
    const initial = await page.evaluate(() => {
      const stage = document.querySelector('.story-stage')
      const rect = stage?.getBoundingClientRect()
      return { route: location.pathname, search: location.search, blur: stage ? getComputedStyle(stage).backdropFilter : null, smooth: document.documentElement.classList.contains('lenis'), draws: window.__diagnosticDraws,
        radarElements: document.querySelectorAll('.radar, .radar-canvas, .radar-track, .story-stage').length,
        mask: document.querySelector('.radar-canvas') ? getComputedStyle(document.querySelector('.radar-canvas')).maskImage : null,
        backgroundCanvases: document.querySelectorAll('.home-background canvas').length, geometry: rect ? { width: rect.width, height: rect.height, top: rect.top } : null, overflow: document.documentElement.scrollWidth - innerWidth }
    })
    assert.equal(initial.route, rendererCandidate ? `/${directory}/${variant}/index.html` : staticReference ? `/${directory}/static-reference/index.html` : '/')
    assert.equal(initial.search, (staticReference || rendererCandidate) ? '' : `?localDiagnostic=${variant}`)
    if (blockOff) {
      assert.equal(initial.radarElements, 0)
      assert.equal(initial.geometry, null)
      assert.equal(initial.blur, null)
    } else assert.equal(initial.blur === 'none', (isolateMotion && variant !== 'effects-only') || staticReference || variant === 'blur-off')
    assert.equal(initial.smooth, isolateMotion ? ['motion-engine', 'motion-all'].includes(variant) : !staticReference && variant !== 'native-scroll')
    assert.equal(initial.draws > 0, isolateMotion ? ['motion-story', 'motion-story-background', 'motion-all'].includes(variant) : !staticReference && !blockOff && variant !== 'radar-off')
    assert.equal(initial.backgroundCanvases > 0, isolateMotion ? ['motion-background', 'motion-story-background', 'motion-all'].includes(variant) : !staticReference && variant !== 'background-off')
    if (maskOff || staticReference) assert.equal(initial.mask, 'none')
    if (staticReference) {
      const control = JSON.parse(await readFile('/home/bigboss/.local/share/watchdemo-site-qa-diagnostics-01/result.json', 'utf8'))
      assert.deepEqual(initial.geometry, control.results.find(result => result.variant === 'normal').initial.geometry)
      assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length), 0)
    }
    if (boundedMotion || rendererCandidate) {
      if (boundedMotion) {
      const resolution = await page.locator('.radar-canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height }))
      assert(resolution.width <= 1024 && resolution.height <= 1024)
      const before = await page.evaluate(() => ({ draws: window.__diagnosticDraws, time: performance.now() }))
      await page.waitForTimeout(1200)
      const after = await page.evaluate(() => ({ draws: window.__diagnosticDraws, time: performance.now() }))
      const rate = (after.draws - before.draws) * 1000 / (after.time - before.time)
      assert(rate > 10 && rate <= 65, `Unexpected radar draw rate: ${rate}`)
      initial.resolution = resolution
      initial.drawRate = rate
      }
      if (radarWebgl) {
        const glState = await page.locator('.story-stage canvas.radar-canvas').evaluate(canvas => {
          const gl = canvas.getContext('webgl2')
          return { backend: canvas.dataset.localRadarBackend, lost: gl.isContextLost(), error: gl.getError(), width: canvas.width, height: canvas.height }
        })
        assert.equal(glState.backend, 'webgl2')
        assert.equal(glState.lost, false)
        assert.equal(glState.error, 0)
        assert(glState.width > 0 && glState.height > 0)
        initial.glState = glState
      }
      if (radarLayers) {
        assert.equal(await page.locator('.story-stage canvas.radar-layer').count(), 37)
        assert.equal(await page.locator('.story-stage canvas.radar-canvas').count(), 0)
      }
      const slider = page.locator('.radar [role="slider"]')
      await slider.focus()
      const initialTime = Number(await slider.getAttribute('aria-valuenow'))
      await page.keyboard.press('End')
      await page.waitForTimeout(1800)
      console.log('bounded-seek-end', await slider.evaluate(element => ({ now: element.getAttribute('aria-valuenow'), max: element.getAttribute('aria-valuemax'), scrollY, storyBottom: document.querySelector('.story').getBoundingClientRect().bottom + scrollY - innerHeight })))
      const endTime = Number(await slider.getAttribute('aria-valuenow'))
      assert(endTime > initialTime)
      await page.keyboard.press('Home')
      await page.waitForFunction(() => scrollY < 2)
      await page.waitForTimeout(100)
      assert(Math.abs(Number(await slider.getAttribute('aria-valuenow')) - initialTime) <= 2)
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
