// The default social image (public/og.png): the home hero at 1200x630 once the intro
// settles, signed out, without the version line. Run against a mock build:
//   npm run build:mock && npm run serve   (another terminal)
//   npm run og [-- <url> [out.png]]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [url = 'http://127.0.0.1:4400/', out = path.join(root, 'public', 'og.png')] = process.argv.slice(2)

// playwright-core ships no browser: its own download if present, else an installed Chrome or Edge.
async function launch() {
  for (const opts of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try {
      return await chromium.launch(opts)
    } catch {}
  }
  throw new Error('No Chromium found: run `npx playwright-core install chromium` or install Chrome')
}

const browser = await launch()
const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => localStorage.setItem('wd-mock-user', 'anon'))
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'load' })
await page.addStyleTag({ content: '.hero .home-meta{visibility:hidden}' })
await page.waitForTimeout(3500)
await page.screenshot({ path: out })
await browser.close()
console.log(`wrote ${out}`)
