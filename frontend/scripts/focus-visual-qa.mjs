import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
const url = new URL(process.env.FOCUS_SITE_URL ?? 'http://127.0.0.1:4520')
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Local verification URLs only')
const output = '/tmp/watchdemo-focus-visual'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', chromiumSandbox: true })
const shots = []
try {
  for (const width of [390, 820, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } })
    await page.goto(url.href, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${output}/hero-${width}.png` })
    if (width !== 820) for (const id of ['focus-cs2', 'features', 'ch-sets', 'ch-notes']) {
      await page.locator(`#${id}`).evaluate(element => element.scrollIntoView())
      await page.waitForTimeout(700)
      await page.locator(`#${id} img`).evaluateAll(images => Promise.all(images.map(image => { image.loading = 'eager'; return image.decode() })))
      const path = `${output}/${id}-${width}.png`
      await page.screenshot({ path })
      shots.push({ width, id, path })
    }
    await page.close()
  }
  await writeFile(`${output}/report.json`, JSON.stringify(shots, null, 2))
  console.log(JSON.stringify({ sectionScreenshots: shots.length, heroScreenshots: 3 }))
} finally { await browser.close() }
