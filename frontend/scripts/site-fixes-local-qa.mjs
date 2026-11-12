// Real, isolated Compose acceptance. Never accepts a user-supplied host or production DB.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
const inspect = name => JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8' }))[0]
const frontend = inspect('watchdemo-local-frontend-1')
const db = inspect('watchdemo-local-postgres-1')
for (const container of [frontend, db]) {
  assert.equal(container.Config.Labels['com.docker.compose.project'], 'watchdemo-local')
  assert.equal(Object.keys(container.NetworkSettings.Networks).length, 1)
  assert(container.HostConfig.Memory > 0 && container.HostConfig.NanoCpus > 0)
  assert.equal(Object.keys(container.NetworkSettings.Ports ?? {}).filter(key => container.NetworkSettings.Ports[key]).length, 0)
}
const ip = Object.values(frontend.NetworkSettings.Networks)[0].IPAddress
assert.match(ip, /^172\.\d+\.\d+\.\d+$/)
const origin = `https://${ip}:8443`
const out = process.env.QA_OUTPUT_DIR
assert(out?.startsWith('/home/bigboss/.local/share/watchdemo-site-qa-'))
await mkdir(out) // Fresh output only.
const browser = await chromium.launch({ headless: false, executablePath: '/home/bigboss/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--js-flags=--max-old-space-size=192'] })
const results = [], errors = [], rejected = []
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: 'reduce', deviceScaleFactor: 1, serviceWorkers: 'block' })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) { rejected.push(url.href); return route.abort() }
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const shot = async name => page.screenshot({ path: `${out}/${name}.png` })
  if (process.env.QA_PHASE !== 'account') {
  for (const width of [375, 390, 768, 1280, 1920, 2560, 3840]) {
    await page.setViewportSize({ width, height: width >= 1920 ? Math.round(width * 9 / 16) : 900 })
    for (const route of ['/', '/login', '/register']) {
      assert.equal((await page.goto(origin + route, { waitUntil: 'networkidle' })).status(), 200)
      await page.locator('h1').waitFor()
      const geometry = await page.evaluate(() => {
        const stage = document.querySelector('.story-stage')?.getBoundingClientRect()
        const foot = document.querySelector('.auth-foot')
        return { width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth,
          stage: stage && { width: stage.width, height: stage.height },
          foot: foot && [...foot.children].map(el => { const r = el.getBoundingClientRect(); return { y: r.y, bottom: r.bottom, height: r.height } }) }
      })
      assert(geometry.overflow <= 1, `${route} ${width}: ${JSON.stringify(geometry)}`)
      assert.equal(await page.locator('a[href*="zeroikins"], a[href="/legal"], a[href="/legal/privacy"], a[href="/legal/terms"]').count(), 0)
      if (geometry.foot?.length > 1) assert(Math.abs(geometry.foot[0].y - geometry.foot[1].y) < 2, `auth footer shifted ${JSON.stringify(geometry)}`)
      results.push({ route, ...geometry })
      if ([375, 1280, 1920, 2560].includes(width)) await shot(`${route.replaceAll('/', '') || 'home'}-${width}`)
    }
  }
  for (const route of ['/legal', '/legal/privacy', '/legal/terms', '/en/legal/offer']) {
    assert.equal((await page.goto(origin + route)).status(), 404, route)
  }
  for (const route of ['/legal/cookies', '/en/legal/cookies', '/pricing', '/en/pricing', '/help', '/en/help', '/auth/social/complete?failed=1']) {
    await page.setViewportSize({ width: 375, height: 900 })
    assert.equal((await page.goto(origin + route, { waitUntil: 'networkidle' })).status(), 200)
    assert.equal(await page.locator('a[href*="zeroikins"]').count(), 0)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    if (route.startsWith('/auth/social/complete')) {
      await page.locator('.auth-card').waitFor()
      await page.getByRole('link', { name: /вход/i }).waitFor()
      await shot('social-callback-error-375')
    }
  }
  }
  if (process.env.QA_PHASE !== 'layout') {
  // Only this synthetic local account is elevated; SQL goes through the verified Compose container.
  const username = `siteqa${Date.now()}`, email = `${username}@example.com`, password = 'Local-acceptance-42!'
  const registered = await context.request.post(origin + '/api/v1/auth/register', { data: { username, email, password, locale: 'ru' } })
  assert.equal(registered.status(), 201, await registered.text())
  execFileSync('docker', ['exec', 'watchdemo-local-postgres-1', 'psql', '-U', 'watchdemo_local', '-d', 'watchdemo_local', '-v', 'ON_ERROR_STOP=1', '-c', `UPDATE users SET is_verified=true, role='admin' WHERE username='${username}'`])
  await page.goto(origin + '/login', { waitUntil: 'networkidle' })
  await page.locator('input[autocomplete="username"]').fill(email)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL('**/account')
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto(origin + '/admin/maintenance', { waitUntil: 'networkidle' })
  const ru = page.locator('textarea[name="text_ru"]'), en = page.locator('textarea[name="text_en"]')
  await ru.waitFor()
  await ru.fill('Проводим технические работы. Сайт доступен в обычном режиме.')
  await en.fill('')
  await page.getByRole('checkbox').check()
  await page.locator('form button[type="submit"]').click()
  await page.locator('.maintenance-banner').waitFor()
  assert.match(await page.locator('.maintenance-banner').innerText(), /Проводим технические работы/)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile admin overflow')
  await page.locator('.maintenance-form').scrollIntoViewIfNeeded()
  await shot('maintenance-admin-375')
  for (const route of ['/', '/login', '/register', '/account', '/en/']) {
    await page.goto(origin + route, { waitUntil: 'networkidle' })
    await page.locator('.maintenance-banner').waitFor()
    assert.match(await page.locator('.maintenance-banner').innerText(), /Проводим технические работы/)
    assert.equal(await page.locator('.maintenance-banner button').count(), 0)
    if (route === '/') await shot('maintenance-home-375')
  }
  // Public auth pages are checked in a separate anonymous context.
  const anon = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: 'reduce', viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  const ap = await anon.newPage()
  for (const route of ['/login', '/register']) {
    await ap.goto(origin + route, { waitUntil: 'networkidle' })
    await ap.locator('.maintenance-banner').waitFor()
    await ap.screenshot({ path: `${out}/maintenance-${route.slice(1)}-1280.png` })
    await ap.keyboard.press('Tab')
    assert(await ap.evaluate(() => document.activeElement !== document.body))
  }
  await anon.close()
  await page.goto(origin + '/admin/maintenance', { waitUntil: 'networkidle' })
  await page.getByRole('checkbox').uncheck()
  await page.locator('form button[type="submit"]').click()
  await page.locator('.maintenance-banner').waitFor({ state: 'detached' })
  results.push({ registration: 201, realAdminEditor: true, bannerRuAndEnFallback: true, authKeyboard: true })
  }
  // The normal hardware rendering path stays active for real round/keyboard/pointer checks.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(origin, { waitUntil: 'networkidle' })
  const slider = page.locator('.radar [role="slider"]')
  await slider.focus(); await slider.press('End')
  await page.waitForTimeout(300)
  const end = Number(await slider.getAttribute('aria-valuenow'))
  await slider.press('Home'); await page.waitForTimeout(300)
  const start = Number(await slider.getAttribute('aria-valuenow'))
  assert(end > start, `seek failed ${end} ${start}`)
  const canvas = page.locator('.radar canvas')
  const first = await canvas.evaluate(el => el.toDataURL())
  await slider.press('ArrowRight'); await page.waitForTimeout(350)
  const second = await canvas.evaluate(el => el.toDataURL())
  assert.notEqual(first, second, 'round image does not change on keyboard seek')
  await slider.click({ position: { x: 100, y: 10 } })
  await page.mouse.wheel(0, 550)
  await shot('map-normal-motion-375')
  results.push({ keyboardSeek: { start, end }, mapPaintChanges: true })
  assert.deepEqual(errors, [])
  assert.deepEqual(rejected, [])
  await writeFile(`${out}/result.json`, JSON.stringify({ origin, results, errors, rejected, limitations: ['No actual Steam/FACEIT provider login or physical-phone Safari acceptance.'] }, null, 2))
  console.log(`PASS ${results.length} real Compose checks; screenshots ${out}; ${origin}`)
} finally { await browser.close() }
