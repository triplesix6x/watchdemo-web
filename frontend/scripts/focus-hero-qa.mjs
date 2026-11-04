import { chromium } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8')
const base = new URL(process.env.FOCUS_URL ?? 'http://127.0.0.1:5173/scripts/focus-preview.html')
if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Local verification URLs only')
const output = process.env.FOCUS_OUTPUT ?? '/tmp/watchdemo-focus-hero-qa'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', chromiumSandbox: true })
const reports = []
function urlFor(locale) {
  const url = new URL(base)
  if (url.pathname.endsWith('focus-preview.html')) url.searchParams.set('lang', locale)
  else url.pathname = locale === 'en' ? '/en' : '/'
  return url.href
}
const instrument = () => {
  window.focusEffects = { draws: 0, brush: 0, pulse: 0 }
  const names = new WeakMap()
  const proto = WebGL2RenderingContext.prototype
  const locate = proto.getUniformLocation
  proto.getUniformLocation = function(program, name) {
    const result = locate.call(this, program, name)
    if (result) names.set(result, name)
    return result
  }
  const brush = proto.uniform4f
  proto.uniform4f = function(location, x, y, z, w) {
    if (names.get(location) === 'uBrush') window.focusEffects.brush = Math.max(window.focusEffects.brush, w)
    return brush.call(this, location, x, y, z, w)
  }
  const pulse = proto.uniform4fv
  proto.uniform4fv = function(location, values, ...rest) {
    if (names.get(location)?.startsWith('uPulses')) {
      for (let i = 3; i < values.length; i += 4) window.focusEffects.pulse = Math.max(window.focusEffects.pulse, values[i])
    }
    return pulse.call(this, location, values, ...rest)
  }
  const draw = proto.drawArraysInstanced
  proto.drawArraysInstanced = function(...args) { window.focusEffects.draws++; return draw.apply(this, args) }
}
try {
  for (const locale of ['ru', 'en']) for (const width of [375, 390, 820, 1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(instrument)
    await page.goto(urlFor(locale), { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForSelector('.focus-backdrop [data-webgl="ready"]')
    const bounds = await page.locator('.focus-hero').boundingBox()
    const x = width * .76, y = Math.min(780, bounds.y + bounds.height * .48)
    await page.mouse.move(x, y)
    await page.waitForFunction(() => window.focusEffects.brush > .05)
    await page.mouse.click(x, y)
    await page.waitForFunction(() => window.focusEffects.pulse > .05)
    await page.addScriptTag({ content: axe })
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })))
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument')
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.focus-copy h1' })
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    await cdp.detach()
    const layout = await page.evaluate(() => {
      const hero = document.querySelector('.focus-hero'), frame = document.querySelector('.focus-product picture')
      const scene = hero.getBoundingClientRect(), product = frame.getBoundingClientRect()
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        brokenImages: [...document.querySelectorAll('.focus-hero img')].filter(image => !image.complete || !image.naturalWidth).map(image => image.src),
        fontFamily: getComputedStyle(document.querySelector('.focus-copy h1')).fontFamily,
        lightOffset: Math.abs(parseFloat(hero.style.getPropertyValue('--stage-light-y')) - (product.bottom - scene.top + 24)),
        download: document.querySelector('.focus-primary').getAttribute('href'),
      }
    })
    layout.fonts = fonts
    const onestRendered = fonts.length > 0 && fonts.every(font => font.postScriptName === 'Onest-SemiBold' && font.isCustomFont && font.glyphCount > 0)
    if (layout.overflow || layout.brokenImages.length || !onestRendered || layout.lightOffset > 1 || errors.length || violations.length || layout.download !== (locale === 'en' ? '/en/download' : '/download')) throw new Error(JSON.stringify({ locale, width, layout, errors, violations }))
    await page.screenshot({ path: `${output}/${locale}-${width}-live.png`, fullPage: true })
    const toggle = page.locator('.focus-static')
    await toggle.focus(); await page.keyboard.press('Enter')
    await page.waitForFunction(() => !document.querySelector('.focus-backdrop canvas'))
    await page.keyboard.press('Enter')
    await page.waitForSelector('.focus-backdrop [data-webgl="ready"]')
    const contextHealthy = await page.locator('.focus-backdrop canvas').evaluate(canvas => { const gl = canvas.getContext('webgl2'); return gl !== null && !gl.isContextLost() && gl.getError() === 0 })
    if (!contextHealthy) throw new Error('WebGL remount failed')
    await page.setViewportSize({ width, height: 400 })
    await page.evaluate(() => {
      const hero = document.querySelector('.focus-hero')
      scrollTo(0, hero.getBoundingClientRect().bottom + scrollY + 30)
    })
    await page.waitForTimeout(600)
    const fullyOffscreen = await page.locator('.focus-backdrop').evaluate(element => element.getBoundingClientRect().bottom <= 0)
    if (!fullyOffscreen) throw new Error('Verification did not leave the terrain viewport')
    const before = await page.evaluate(() => window.focusEffects.draws)
    await page.waitForTimeout(350)
    const after = await page.evaluate(() => window.focusEffects.draws)
    if (before !== after) throw new Error('Offscreen terrain kept drawing')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => !document.querySelector('.focus-backdrop canvas'))
    if (!await toggle.isDisabled()) throw new Error('Reduced-motion static control was not disabled')
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: `${output}/${locale}-${width}-reduced.png`, fullPage: true })
    reports.push({ locale, width, layout, errors, violations, contextHealthy, offscreenDraws: after - before })
    await page.close()
  }
  const fallback = await browser.newPage()
  await fallback.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.startsWith('webgl') ? null : get.call(this, type, ...args) }
  })
  await fallback.goto(urlFor('ru'), { waitUntil: 'networkidle' })
  const image = await fallback.locator('.focus-contours').evaluate(element => ({ image: getComputedStyle(element).backgroundImage, opacity: getComputedStyle(element).opacity }))
  if (!image.image.includes('contours.svg') || +image.opacity === 0) throw new Error('Missing static WebGL fallback')
  reports.push({ noWebGL: true, image })
  await writeFile(`${output}/report.json`, JSON.stringify(reports, null, 2))
  console.log(JSON.stringify({ cases: reports.length, fails: [] }))
} finally { await browser.close() }
