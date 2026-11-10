import { qaTarget, guardContext, freshOutputDirectory } from './qa-safety.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from 'playwright-core'

const target = qaTarget(process.env.QA_ORIGIN)
const origin = target.origin
const out = await freshOutputDirectory()
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', chromiumSandbox: true })
async function newGuardedPage(options) {
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' })
  await guardContext(context, target)
  const page = await context.newPage()
  page.on('close', () => { void context.close() })
  return page
}

const report = []
const languages = [
  { path: '/', accent: 'прямо в игре.', lead: 'WatchDemo собирает демки в библиотеку, сам находит убийства, клатчи и опенинги и открывает нужный момент прямо в игре.' },
  { path: '/en/', accent: 'right in the game.', lead: 'WatchDemo keeps your demos in one library, finds kills, clutches and openings on its own, and opens the moment you need right in the game.' },
]
try {
  for (const width of [375, 1280]) {
    for (const language of languages) {
      const page = await newGuardedPage({ viewport: { width, height: 900 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
      await page.goto(`${origin}${language.path}`, { waitUntil: 'networkidle' })
      await page.evaluate(() => document.fonts.ready)
      await page.locator('#curtain').waitFor({ state: 'hidden' })
      await page.locator('.home-background canvas').waitFor()
      assert.equal(await page.locator('.review-controls').count(), 0, 'No comparison tooling ships')
      const material = await page.locator('.story-stage').evaluate(node => {
        const s = getComputedStyle(node)
        return { color: s.backgroundColor, blur: s.backdropFilter, transform: s.transform }
      })
      assert.equal(material.color, 'rgba(13, 15, 19, 0.28)')
      assert.ok(material.blur.includes('12px'))
      assert.equal(material.transform, 'none')
      const buffer = await page.locator('.story-stage canvas').evaluate(canvas => [canvas.width, canvas.height])
      assert.ok(buffer[0] > 0 && buffer[0] === buffer[1])
      const gl = await page.locator('.home-background canvas').evaluate(canvas => { const gl = canvas.getContext('webgl2'); return { lost: gl.isContextLost(), error: gl.getError() } })
      assert.deepEqual(gl, { lost: false, error: 0 })
      const accent = page.locator('.hero-lead-accent')
      assert.equal(await accent.textContent(), language.accent)
      assert.equal(await page.locator('.hero-lead').textContent(), language.lead)
      const initial = await accent.evaluate(node => {
        const s = getComputedStyle(node)
        return { background: s.backgroundImage, animation: s.animationName, duration: s.animationDuration, timing: s.animationTimingFunction, direction: s.animationDirection, backgroundSize: s.backgroundSize, size: s.fontSize, weight: s.fontWeight }
      })
      assert.ok(initial.background.includes('115deg'))
      assert.equal(initial.animation, 'hero-lead-sheen')
      assert.equal(initial.duration, '6s')
      assert.equal(initial.timing, 'linear')
      assert.equal(initial.direction, 'normal')
      assert.equal(initial.backgroundSize, '200% 100%')
      const keyframes = await accent.evaluate(node => node.getAnimations()[0].effect.getKeyframes().map(frame => `${frame.backgroundPositionX} ${frame.backgroundPositionY}`))
      assert.deepEqual(keyframes, ['0% 50%', '-200% 50%']) // 200%-wide image: negative position percentages move the tile right.
      const first = await accent.evaluate(node => getComputedStyle(node).backgroundPosition)
      await page.waitForTimeout(250)
      const second = await accent.evaluate(node => getComputedStyle(node).backgroundPosition)
      assert.notEqual(first, second, 'Real CSS animation progresses without a JS animation loop')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      const leadBefore = await page.locator('.hero-lead').boundingBox()
      const animations = await accent.evaluate(node => node.getAnimations().map(a => a.animationName))
      assert.ok(animations.includes('hero-lead-sheen'))
      await page.screenshot({ path: `${out}/${width}-${language.path === '/' ? 'ru' : 'en'}.png` })
      if (width === 1280 && language.path === '/') {
        await accent.evaluate(node => { const animation = node.getAnimations()[0]; animation.pause(); animation.currentTime = 5999 })
        await accent.screenshot({ path: `${out}/seam-before.png` })
        await accent.evaluate(node => { node.getAnimations()[0].currentTime = 6001 })
        await accent.screenshot({ path: `${out}/seam-after.png` })
      }
      const track = page.locator('.radar-track')
      const beforeSeek = Number(await track.getAttribute('aria-valuenow'))
      await track.focus(); await track.press('ArrowRight')
      await page.waitForFunction(before => Number(document.querySelector('.radar-track').getAttribute('aria-valuenow')) > before, beforeSeek)
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      await page.waitForFunction(() => !document.querySelector('.home-background canvas'))
      await page.evaluate(() => scrollTo(0, 0))
      await page.locator('.home-background canvas').waitFor()
      await page.locator('.hero-actions a[href$="/download"]').click()
      await page.waitForURL(/\/download$/)
      await page.locator('#curtain').waitFor({ state: 'hidden' })
      assert.equal(await page.locator('.home-background').count(), 0)
      await page.locator(`a[href="${language.path === '/' ? '/' : '/en'}"]`).first().click()
      await page.locator('#curtain').waitFor({ state: 'hidden' })
      await page.locator('.home-background canvas').waitFor()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForFunction(() => !document.querySelector('.home-background canvas'))
      assert.equal(await accent.evaluate(node => getComputedStyle(node).animationName), 'none')
      assert.ok((await accent.evaluate(node => getComputedStyle(node).backgroundImage)).includes('115deg'))
      // Allow story-driven scroll positioning; typography itself keeps its original dimensions.
      const leadAfter = await page.locator('.hero-lead').boundingBox()
      assert.equal(leadAfter.width, leadBefore.width)
      assert.equal(leadAfter.height, leadBefore.height)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] })
      await page.waitForFunction(() => !document.querySelector('.home-background canvas'))
      assert.equal(await page.locator('.story-stage').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(13, 15, 19)')
      await cdp.send('Emulation.setEmulatedMedia', { features: [] })
      await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'active' })
      const forced = await accent.evaluate(node => { const s = getComputedStyle(node); return { background: s.backgroundImage, animation: s.animationName, color: s.color } })
      assert.equal(forced.background, 'none')
      assert.equal(forced.animation, 'none')
      assert.notEqual(forced.color, 'rgba(0, 0, 0, 0)')
      assert.deepEqual(errors, [])
      report.push({ width, language: language.path, initial, material, buffer, gl, lifecycle: 'offscreen unmount / return remount', timeline: 'ArrowRight seeks', positions: [first, second], reducedMotion: 'static gradient', forcedColors: forced, errors })
      await page.close()
    }
  }
  const unsupported = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  await guardContext(unsupported, target)
  await unsupported.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind === 'webgl2' ? null : original.call(this, kind, ...args)
    }
  })
  const fallback = await unsupported.newPage()
  const fallbackErrors = []
  fallback.on('pageerror', error => fallbackErrors.push(error.message))
  await fallback.goto(origin, { waitUntil: 'networkidle' })
  await fallback.locator('.home-background canvas').waitFor()
  assert.equal(await fallback.locator('.hero-lead-accent').textContent(), languages[0].accent)
  assert.equal(await fallback.locator('.story-stage canvas').evaluate(canvas => Boolean(canvas.getContext('2d'))), true)
  assert.deepEqual(fallbackErrors, [])
  report.push({ unsupportedWebGL2: 'Original page and 2D map remain usable', errors: fallbackErrors })
  await unsupported.close()
} finally {
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(`GhostFibers home: ${report.length} viewport/language cases passed; ${out}`)
