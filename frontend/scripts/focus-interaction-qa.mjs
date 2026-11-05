import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8')
const base = new URL(process.env.FOCUS_SITE_URL ?? 'http://127.0.0.1:4520')
if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Local verification URLs only')
const out = '/tmp/watchdemo-focus-interaction'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', chromiumSandbox: true })
const results = []
try {
  for (const width of [375, 820, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.addInitScript(() => { localStorage.setItem('wd-mock-user', 'admin'); localStorage.setItem('wd-mock-delay', '0') })
    await page.goto(new URL('/admin/support', base).href, { waitUntil: 'networkidle' })
    await page.locator('.sp-ticket').first().click()
    const log = page.getByRole('log')
    await log.waitFor()
    assert.ok(await log.getByRole('list').getByRole('listitem').count() > 0)
    const bounds = await page.locator('.sp-log').boundingBox()
    assert.ok(bounds.width > 100 && bounds.height > 100)
    const layout = await page.evaluate(() => {
      const body = document.querySelector('.sp-thread-body').getBoundingClientRect()
      const composer = document.querySelector('.sp-thread-body .sp-composer').getBoundingClientRect()
      return { footerGap: body.bottom - composer.bottom, regionGrowth: getComputedStyle(document.querySelector('.sp-log-region')).flexGrow }
    })
    assert.equal(layout.regionGrowth, '1')
    assert.ok(layout.footerGap <= 24, `Composer detached from thread footer: ${layout.footerGap}`)
    await page.addScriptTag({ content: axe })
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })))
    assert.deepEqual(violations, [])
    await page.screenshot({ path: `${out}/support-${width}.png` })
    results.push({ support: width, bounds, layout, violations })
    await page.close()
  }
  for (const width of [375, 1440]) for (const motion of ['reduce', 'no-preference']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: motion })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(new URL('/en', base).href, { waitUntil: 'networkidle' })
    const slider = page.getByRole('slider')
    await slider.focus(); await page.keyboard.press('Home'); await page.waitForTimeout(200)
    assert.equal(await slider.getAttribute('aria-valuenow'), '0')
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
    const title = await page.locator('#event-plant-title').boundingBox()
    const stage = await page.locator('.story-stage').boundingBox()
    assert.ok(title.y >= (width < 900 ? stage.y + stage.height - 1 : 64))
    await page.screenshot({ path: `${out}/episode-${width}-${motion}.png` })
    await slider.focus(); await page.keyboard.press('End'); await page.waitForTimeout(200)
    assert.equal(await slider.getAttribute('aria-valuenow'), '75')
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(200)
    assert.equal(await slider.getAttribute('aria-valuenow'), '73')
    const canvas = await page.locator('.radar canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height }))
    assert.equal(canvas.width, canvas.height)
    await page.locator('.home-final a[href="/en/download"]').click()
    await page.waitForURL('**/en/download')
    // The existing public-route curtain consumes input until its entrance settles.
    await page.locator('#curtain').waitFor({ state: 'hidden' })
    await page.locator('.site-header .brand').click()
    await page.waitForURL(url => /^\/en\/?$/.test(url.pathname))
    await page.getByRole('slider').focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200)
    assert.equal(await page.getByRole('slider').getAttribute('aria-valuenow'), '2')
    await page.locator('#features').evaluate(element => element.scrollIntoView())
    await page.waitForTimeout(250)
    assert.ok((await page.locator('.story-stage').boundingBox()).y + (await page.locator('.story-stage').boundingBox()).height <= 64)
    assert.deepEqual(errors, [])
    results.push({ width, motion, canvas, title, stage, remount: '2', errors })
    await page.close()
  }
  await writeFile(`${out}/report.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ cases: results.length, failures: [] }))
} finally { await browser.close() }
