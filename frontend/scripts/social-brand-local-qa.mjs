// Brand UI acceptance only: enabled/provider-error states are browser-local fixtures, not live OAuth.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
const container = JSON.parse(execFileSync('docker', ['inspect', 'watchdemo-local-frontend-1'], { encoding: 'utf8' }))[0]
assert.equal(container.Config.Labels['com.docker.compose.project'], 'watchdemo-local')
assert.equal(Object.keys(container.NetworkSettings.Networks).length, 1)
assert(container.HostConfig.Memory > 0 && container.HostConfig.NanoCpus > 0)
assert(!Object.values(container.NetworkSettings.Ports ?? {}).some(Boolean))
const network = Object.values(container.NetworkSettings.Networks)[0]
const net = JSON.parse(execFileSync('docker', ['network', 'inspect', network.NetworkID], { encoding: 'utf8' }))[0]
assert.equal(net.Internal, true)
const origin = `https://${network.IPAddress}:8443`
const out = process.env.QA_OUTPUT_DIR
assert(out?.startsWith('/home/bigboss/.local/share/watchdemo-site-qa-brand-'))
await mkdir(out)
const browser = await chromium.launch({ headless: false, executablePath: '/home/bigboss/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--js-flags=--max-old-space-size=192'] })
const results = [], errors = [], rejected = [], starts = []
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: 'reduce', serviceWorkers: 'block', viewport: { width: 1280, height: 900 } })
  let fixture = false
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) { rejected.push(url.origin); return route.abort() }
    if (fixture && url.pathname === '/api/v1/auth/social/providers') return route.fulfill({ json: { steam: true, faceit: true } })
    if (fixture && url.pathname === '/api/v1/auth/social/connections') return route.fulfill({ json: { steam: { available: true, linked: false }, faceit: { available: true, linked: false } } })
    if (fixture && /\/auth\/social\/(steam|faceit)\/(start|connect)$/.test(url.pathname)) {
      starts.push({ path: url.pathname, body: route.request().postDataJSON() })
      await new Promise(resolve => setTimeout(resolve, 250))
      return route.fulfill({ status: 503, json: { detail: 'Local QA provider unavailable' } })
    }
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  async function checkButtons(path, width, enabled) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(origin + path, { waitUntil: 'networkidle' })
    await page.locator('.social-provider-faceit').first().waitFor()
    await page.mouse.move(0, 0)
    await page.waitForFunction(() => [...document.querySelectorAll('.social-provider')].every(button => !button.matches(':hover') && getComputedStyle(button).backgroundColor === (button.classList.contains('social-provider-faceit') ? 'rgb(255, 85, 0)' : 'rgb(23, 29, 37)')))
    await page.evaluate(() => document.fonts.ready)
    const data = await page.locator('.social-provider').evaluateAll(buttons => buttons.map(button => {
      const icon = button.querySelector('svg'), text = button.querySelector('span:last-child')
      const r = button.getBoundingClientRect(), i = icon.getBoundingClientRect(), t = text.getBoundingClientRect(), css = getComputedStyle(button)
      return { text: text.textContent, disabled: button.disabled, background: css.backgroundColor, iconHidden: icon.getAttribute('aria-hidden'), iconLeft: i.left >= r.left && i.right <= t.left, height: r.height, width: r.width, right: r.right }
    }))
    assert.equal(data.length, 2)
    for (let i = 0; i < 2; i++) {
      assert(data[i].text.endsWith(i ? 'FACEIT' : 'Steam'))
      assert.equal(data[i].background, i ? 'rgb(255, 85, 0)' : 'rgb(23, 29, 37)')
      assert.equal(data[i].iconHidden, 'true')
      assert(data[i].iconLeft && data[i].height >= 44 && data[i].right <= width + 1, JSON.stringify(data[i]))
      assert.equal(data[i].disabled, !enabled)
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: `${out}/${path.slice(1).replaceAll('/', '-')}-${width}-${enabled ? 'enabled' : 'disabled'}.png` })
    results.push({ path, width, enabled, data })
  }
  await checkButtons('/login', 375, true)
  assert.equal(await page.locator('.social-auth .note').count(), 0)
  assert.equal(await page.getByText('Сервис не настроен. Используйте другой способ входа.', { exact: true }).count(), 0)
  // Availability is false on this local backend, but login remains clickable.
  // Server-side configuration checks must still reject an unconfigured provider.
  for (const provider of ['steam', 'faceit']) {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/auth/social/${provider}/start`)
    await page.locator(`.social-provider-${provider}`).click()
    assert((await response).status() >= 400)
    await page.waitForFunction(() => document.querySelector('.social-auth').getAttribute('aria-busy') === 'false')
    assert(await page.locator(`.social-provider-${provider}`).isEnabled())
  }
  // Confirm this is the newly built production module, not a cached diagnostic bundle.
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
  const modulePath = html.match(/<script\b(?=[^>]*type="module")[^>]*src="([^"]+\.js)"/)[1]
  assert(await page.locator(`script[type="module"][src="${modulePath}"]`).count())
  fixture = true
  for (const path of ['/login', '/register', '/en/login']) for (const width of [375, 1280]) await checkButtons(path, width, true)
  const steam = page.locator('.social-provider-steam')
  await page.keyboard.press('Tab')
  await steam.focus()
  assert.equal(await steam.evaluate(el => el.matches(':focus-visible')), true)
  assert.equal(await steam.evaluate(el => getComputedStyle(el).outlineWidth), '2px')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.social-auth').getAttribute('aria-busy') === 'true')
  assert(await page.locator('.social-provider-faceit').isDisabled())
  await page.waitForFunction(() => document.querySelector('.social-auth').getAttribute('aria-busy') === 'false')
  assert(await steam.isEnabled())
  assert.equal(starts.at(-1).path, '/api/v1/auth/social/steam/start')
  assert.deepEqual(starts.at(-1).body, { intent: 'login' })
  // Authenticate against the real disposable local backend; never a production account.
  await page.goto(origin + '/login', { waitUntil: 'networkidle' })
  await page.locator('input[autocomplete="username"]').fill('siteqa1794483443717')
  await page.locator('input[autocomplete="current-password"]').fill('Local-acceptance-42!')
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL('**/account')
  for (const width of [375, 1280]) await checkButtons('/account/security', width, true)
  await page.locator('.social-provider-faceit').click()
  await page.waitForFunction(() => document.querySelector('.social-auth').getAttribute('aria-busy') === 'false')
  assert.equal(starts.at(-1).path, '/api/v1/auth/social/faceit/connect')
  assert.deepEqual(starts.at(-1).body, { intent: 'link' })
  assert.deepEqual(errors, [])
  assert.deepEqual(rejected, [])
  await writeFile(`${out}/result.json`, JSON.stringify({ origin, modulePath, results, starts, errors, rejected, limitations: ['Provider-enabled and error responses are browser-local fixtures. No actual Steam/FACEIT authorization performed.'] }, null, 2))
  console.log(`PASS ${results.length} brand UI cases; keyboard/loading/error and real local cabinet; ${origin}; ${out}`)
} finally { await browser.close() }
