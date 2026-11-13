// Functional and GPU-command proof for the two local candidates, not a speed benchmark.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
const info = JSON.parse(execFileSync('docker', ['inspect', 'watchdemo-local-frontend-1'], { encoding: 'utf8' }))[0]
assert.equal(info.Config.Labels['com.docker.compose.project'], 'watchdemo-local')
assert.equal(Object.keys(info.NetworkSettings.Networks).length, 1)
assert(info.HostConfig.Memory > 0 && info.HostConfig.NanoCpus > 0)
assert(Object.values(info.NetworkSettings.Ports ?? {}).every(value => value === null))
const ip = Object.values(info.NetworkSettings.Networks)[0].IPAddress
assert.match(ip, /^172\.\d+\.\d+\.\d+$/)
const origin = `https://${ip}:8443`
const output = process.env.QA_OUTPUT_DIR
assert(output?.startsWith('/home/bigboss/.local/share/watchdemo-matte-qa-'))
await mkdir(output)
const browser = await chromium.launch({ headless: false, executablePath: '/home/bigboss/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' })
const errors = [], rejected = [], results = []
const productionNative = process.env.QA_PRODUCTION_NATIVE === '1'
const widths = process.env.QA_VIEWPORT ? [Number(process.env.QA_VIEWPORT)] : [375, 1920, 2560]
assert(widths.every(width => [375, 1920, 2560].includes(width)))
const nativeLayer = process.env.QA_NATIVE_LAYER === '1'
const nativeGlass = productionNative || nativeLayer || process.env.QA_NATIVE_GLASS === '1'
const visibleGlass = nativeGlass || process.env.QA_GLASS_VISIBLE === '1'
const glass = visibleGlass || process.env.QA_GLASS === '1'
try {
  for (const variant of nativeLayer ? ['native-glass-layer'] : nativeGlass ? ['native-glass'] : visibleGlass ? ['matte-glass-visible'] : glass ? ['matte-glass'] : ['matte-texture', 'matte-live']) {
    const live = !nativeGlass && variant !== 'matte-texture'
    const base = `/${nativeLayer ? '__home-native-layer-20261113' : nativeGlass ? '__home-native-glass-20261113' : visibleGlass ? '__home-glass-visible-20261113' : glass ? '__home-glass-20261113' : '__home-matte-20261113-v2'}/${variant}/`
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: widths.length === 1 ? widths[0] : 1920, height: widths[0] === 375 && widths.length === 1 ? 812 : 1080 }, deviceScaleFactor: 1, serviceWorkers: 'block' })
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { rejected.push(route.request().url()); return route.abort() }
      return route.continue()
    })
    await context.addInitScript(() => {
      const contexts = []
      window.__matteGl = contexts
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (...args) {
        const gl = original.apply(this, args)
        if (args[0] !== 'webgl2' || !gl || gl.__matteObserved) return gl
        gl.__matteObserved = true
        const record = { canvas: this, matte: !!this.closest('.local-live-matte'), frames: 0, full: 0, instanced: 0, allocations: [], compiles: 0, shaders: [], bound: null }
        contexts.push(record)
        const bind = gl.bindFramebuffer.bind(gl)
        gl.bindFramebuffer = (target, framebuffer) => { record.bound = framebuffer; return bind(target, framebuffer) }
        const draw = gl.drawArrays.bind(gl)
        gl.drawArrays = (...a) => { record.full++; if (!record.bound) record.frames++; return draw(...a) }
        const instanced = gl.drawArraysInstanced.bind(gl)
        gl.drawArraysInstanced = (...a) => { record.instanced++; return instanced(...a) }
        const storage = gl.texStorage2D.bind(gl)
        gl.texStorage2D = (...a) => { record.allocations.push(a.slice(3)); return storage(...a) }
        const compile = gl.compileShader.bind(gl)
        gl.compileShader = (...a) => { record.compiles++; return compile(...a) }
        const source = gl.shaderSource.bind(gl)
        gl.shaderSource = (shader, code) => { record.shaders.push(code); return source(shader, code) }
        return gl
      }
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(`${variant}: ${error.message}`))
    const url = productionNative ? origin + '/' : origin + base + 'index.html'
    const productionModule = productionNative ? (await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')).match(/<script\b(?=[^>]*type="module")[^>]*src="([^"]+\.js)"/)[1] : null
    await page.goto(url, { waitUntil: 'networkidle' })
    for (let reload = 0; reload < 2; reload++) {
      await page.locator('.story-stage .radar-canvas').waitFor()
      assert.equal(page.url(), url)
      if (productionNative) {
        assert.equal(await page.locator('script[type="module"]').getAttribute('src'), productionModule)
        assert.equal(await page.locator('[data-diagnostic-badge]').count(), 0)
      } else {
        await page.waitForFunction(variant => document.documentElement.dataset.localDiagnostic === variant, variant)
        assert((await page.locator('script[type="module"]').getAttribute('src')).startsWith(base + 'assets/'))
        assert((await page.locator('[data-diagnostic-badge]').textContent()).includes(`LOCAL: ${variant} ACTIVE`))
      }
      if (live) await page.locator('canvas[data-local-matte="true"]').waitFor()
      if (reload === 0) await page.reload({ waitUntil: 'networkidle' })
    }
    await page.waitForTimeout(3000)
    const snapshot = () => page.evaluate(() => window.__matteGl.filter(record => record.matte).map(record => ({ frames: record.frames, full: record.full, instanced: record.instanced, allocations: record.allocations.length, dimensions: [record.canvas.width, record.canvas.height], maxTarget: Math.max(...record.allocations.flat()), compiles: record.compiles, gaussianShader: record.shaders.some(source => source.includes('0.2270270270') && source.includes('uTexel * 4.0')), kawaseShaders: record.shaders.some(source => source.includes('c / 8.0')) && record.shaders.some(source => source.includes('c / 12.0')), algorithm: record.canvas.dataset.localMatteAlgorithm, connected: record.canvas.isConnected })))
    const before = await snapshot()
    await page.waitForTimeout(1100)
    const after = await snapshot()
    if (live) {
      assert.equal(after.length, 1)
      if (glass) {
        assert(after[0].kawaseShaders)
        assert.equal(after[0].gaussianShader, false)
        assert.equal(after[0].algorithm, 'dual-kawase')
        assert.equal(after[0].allocations, 4, 'One scene and three progressively smaller Kawase targets')
      } else assert(after[0].gaussianShader)
      assert(Math.max(...after[0].dimensions) <= 320)
      assert(after[0].maxTarget <= 320)
      const frames = after[0].frames - before[0].frames
      assert(frames > 10)
      assert.equal(after[0].full - before[0].full, frames * (glass ? 7 : 3), glass ? 'Three downsample and three upsample passes plus final composite per frame' : 'Two real Gaussian passes plus final composite per frame')
      assert.equal(after[0].instanced - before[0].instanced, frames * 4)
      assert.equal(after[0].allocations, before[0].allocations)
      assert.equal(after[0].compiles, before[0].compiles)
    } else assert.equal(after.length, 0)
    const surface = await page.locator('.story-stage').evaluate(stage => ({ backdrop: getComputedStyle(stage).backdropFilter, image: getComputedStyle(stage).backgroundImage, background: getComputedStyle(stage).backgroundColor, filter: getComputedStyle(stage).filter }))
    assert.equal(surface.backdrop, nativeGlass && !nativeLayer ? 'blur(12px) saturate(1.15)' : 'none')
    if (nativeLayer) {
      const decoration = await page.locator('.story-stage').evaluate(stage => {
        const style = getComputedStyle(stage, '::before')
        return { backdrop: style.backdropFilter, background: style.backgroundColor, containment: style.contain, pointer: style.pointerEvents }
      })
      assert.equal(decoration.backdrop, 'blur(12px) saturate(1.15)')
      assert.equal(decoration.background, 'rgba(13, 15, 19, 0.56)')
      assert.equal(decoration.containment, 'paint')
      assert.equal(decoration.pointer, 'none')
    }
    assert.equal(surface.filter, 'none')
    if (nativeGlass) {
      assert.equal(surface.image, 'none')
      assert.equal(surface.background, 'rgba(13, 15, 19, 0.56)')
      assert.equal(await page.locator('.local-live-matte').count(), 0)
      const masks = await page.locator('.radar-map, .radar-canvas').evaluateAll(elements => elements.map(element => getComputedStyle(element).maskImage))
      assert(masks.length >= 2 && masks.every(value => value === 'none'))
    } else assert(surface.image.includes('matte.png'))
    const slider = page.locator('[role="slider"]')
    await slider.focus()
    await page.keyboard.press('End')
    await page.waitForFunction(() => document.querySelector('[role="slider"]').getAttribute('aria-valuenow') === '75')
    await page.keyboard.press('Home')
    await page.waitForFunction(() => window.scrollY < 2)
    const geometries = []
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 1080 })
      await page.waitForTimeout(500)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      if (visibleGlass) {
        const geometry = await page.locator('.story-stage').evaluate(stage => {
          const box = stage.getBoundingClientRect()
          const style = getComputedStyle(stage)
          const saved = stage.getAttribute('style')
          stage.style.setProperty('width', '100%', 'important')
          stage.style.setProperty('--story-stage-height', 'min(calc(100svh - var(--header-h) - 2rem), calc(50cqw + 6rem))', 'important')
          if (innerWidth < 900) stage.style.setProperty('width', 'auto', 'important')
          const original = stage.getBoundingClientRect()
          const baseline = { width: original.width, height: original.height }
          if (saved === null) stage.removeAttribute('style'); else stage.setAttribute('style', saved)
          return { width: box.width, height: box.height, baseline, outline: style.outlineStyle }
        })
        const ratio = width < 900 ? 1 : 0.94
        assert(Math.abs(geometry.width / geometry.baseline.width - ratio) < 0.002)
        assert(Math.abs(geometry.height / geometry.baseline.height - ratio) < 0.002)
        assert.equal(geometry.outline, 'solid')
        geometries.push({ viewport: width, ...geometry })
      }
      if (productionNative) {
        // Bound screenshot readback to the changed surface; viewport/layout checks
        // still use the full requested width. Run each viewport in a fresh process
        // to avoid retaining several large GPU backing sizes under the RAM cap.
        await page.locator('.story-stage').screenshot({ path: `${output}/${variant}-${width}.png` })
      } else await page.screenshot({ path: `${output}/${variant}-${width}.png` })
    }
    if (live) {
      // The sticky stage remains partly visible at the document bottom in BOTH
      // layouts. Exercise its offscreen observer with an explicit QA-only host
      // translation, not a false claim that scrolling made it invisible.
      const reentryStart = await snapshot()
      await page.locator('.local-live-matte').evaluate(element => { element.style.transform = 'translateY(-200vh)' })
      await page.waitForFunction(() => document.querySelector('.local-live-matte').getBoundingClientRect().bottom < 0, undefined, { timeout: 5000 })
      await page.waitForTimeout(400)
      const hiddenStart = await snapshot()
      await page.waitForTimeout(700)
      const hiddenEnd = await snapshot()
      assert.equal(hiddenStart[0].frames, hiddenEnd[0].frames)
      await page.locator('.local-live-matte').evaluate(element => { element.style.transform = '' })
      await page.waitForFunction(() => document.querySelector('.local-live-matte').getBoundingClientRect().bottom > 0)
      await page.waitForTimeout(600)
      const reentryEnd = await snapshot()
      assert.equal(reentryEnd.length, 1)
      assert(reentryEnd[0].frames > hiddenEnd[0].frames)
      assert.equal(reentryEnd[0].allocations, reentryStart[0].allocations)
      assert.equal(reentryEnd[0].compiles, reentryStart[0].compiles)
      assert.equal(await page.locator('canvas[data-local-matte="true"]').evaluate(canvas => canvas.getContext('webgl2').getError()), 0)
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => !document.querySelector('.local-live-matte canvas'))
    const reduced = await page.locator('.story-stage').evaluate(stage => getComputedStyle(stage).backgroundImage)
    if (nativeGlass) assert.equal(reduced, 'none'); else assert(reduced.includes('matte.png'))
    if (productionNative) {
      await page.emulateMedia({ forcedColors: 'active' })
      assert.equal(await page.locator('.story-stage').evaluate(stage => getComputedStyle(stage).backdropFilter), 'none')
      await page.emulateMedia({ forcedColors: 'none', contrast: 'more' })
      assert.equal(await page.locator('.story-stage').evaluate(stage => getComputedStyle(stage).backdropFilter), 'none')
    }
    results.push({ variant, productionNative, productionModule, surface, before, after, geometries, reducedFallback: true, offscreenMethod: live ? 'QA-only decorative host translation; sticky stage cannot fully leave the natural viewport' : 'not applicable' })
    await context.close()
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(rejected, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ results, errors, rejected, limits: 'Functional GPU-command checks, not presented-FPS or affected-device smoothness acceptance.' }, null, 2))
  console.log(JSON.stringify({ variants: results.map(result => result.variant), errors, rejected, output }))
} finally { await browser.close() }
