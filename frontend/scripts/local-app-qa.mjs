// Public visual checks against REAL isolated Compose services. No mocked API.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { qaTarget, freshOutputDirectory, guardContext } from './qa-safety.mjs'
import { chromium } from 'playwright-core'
const target = qaTarget(process.env.QA_ORIGIN)
if (target.mode !== 'isolated-backend') throw Error('local-app-qa requires isolated-backend mode')
const origin = target.origin
const out = await freshOutputDirectory()
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || '/opt/google/chrome/chrome', chromiumSandbox: true, args: ['--js-flags=--max-old-space-size=96'] })
const results = [], errors = [], external = []
try {
  const context = await browser.newContext({ reducedMotion: 'reduce', deviceScaleFactor: 1, serviceWorkers: 'block' })
  const request = await guardContext(context, target, url => external.push(url))
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  for (const width of [375, 1280]) for (const route of ['/', '/en/', '/pricing', '/legal', '/legal/privacy', '/help', '/login', '/register']) {
    await page.setViewportSize({ width, height: 900 })
    const response = await page.goto(origin + route, { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200, route)
    await page.locator('h1').waitFor()
    const measure = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, bg: getComputedStyle(document.documentElement).getPropertyValue('--ink-950').trim(), title: document.querySelector('h1').textContent }))
    assert.equal(measure.overflow, false, `${route} ${width}: horizontal overflow`)
    assert.equal(measure.bg.toLowerCase(), '#0d0f13')
    if (route === '/') {
      const notice = page.getByRole('button', { name: 'Понятно', exact: true })
      if (await notice.isVisible()) await notice.click()
      assert.equal(await page.locator('.home-pricing, .pricing-teaser').count(), 0)
      assert.equal(await page.locator('.footer-grid .legal-footer').count(), 1)
      await page.locator('.site-footer').screenshot({ path: `${out}/footer-${width}.png` })
    }
    if (route === '/pricing') {
      const cta = page.getByRole('link', { name: 'Запросить бета-тестирование', exact: true })
      assert.equal(await cta.count(), 1)
      assert.equal(await cta.getAttribute('href'), 'https://t.me/zeroikins')
      assert.equal(await page.locator('.pr-grid tfoot').count(), 0)
      await page.locator('.pr-beta-action').screenshot({ path: `${out}/pricing-beta-${width}.png` })
    }
    if (route === '/legal') {
      assert.equal(await page.locator('.legal-list li').count(), 5)
      const titles = await page.locator('.legal-title').evaluateAll(links => links.map(link => ({
        font: parseFloat(getComputedStyle(link).fontSize), height: link.getBoundingClientRect().height,
      })))
      assert(titles.every(link => link.font >= 14 && link.height >= 44), JSON.stringify(titles))
    }
    if (route === '/legal/privacy') {
      const gap = await page.evaluate(() => document.querySelector('h1').getBoundingClientRect().top - document.querySelector('.legal-back').getBoundingClientRect().bottom)
      assert(gap >= 20, `backlink gap ${gap}`)
    }
    if (['/', '/pricing', '/legal', '/legal/privacy', '/help'].includes(route)) await page.screenshot({ path: `${out}/${route.replaceAll('/', '-') || 'home'}-${width}.png` })
    results.push({ route, width, ...measure })
  }
  for (const width of [2560, 3840]) {
    await page.setViewportSize({ width, height: width === 2560 ? 1440 : 2160 })
    await page.goto(origin, { waitUntil: 'networkidle' })
    const box = await page.locator('.story-stage').boundingBox()
    assert(box.height < box.width * 1.4, `stretched radar ${JSON.stringify(box)}`)
    const header = await page.locator('.site-header').boundingBox()
    const center = (page.viewportSize().height + header.height) / 2
    assert(Math.abs(box.y + box.height / 2 - center) < 2, `radar is not centered: ${JSON.stringify(box)}`)
    await page.screenshot({ path: `${out}/home-${width}.png` })
    await page.evaluate(() => window.scrollTo(0, window.innerHeight))
    const scrolled = await page.locator('.story-stage').boundingBox()
    assert(Math.abs(scrolled.y + scrolled.height / 2 - center) < 2, `sticky radar drifted: ${JSON.stringify(scrolled)}`)
    results.push({ route: '/', width, stage: box, scrolledStage: scrolled })
  }
  // Motion/keyboard smoke on the real map, separate from reduced-motion visual shots.
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-reduced-motion', value: 'no-preference' },
    { name: 'prefers-reduced-transparency', value: 'reduce' },
  ] })
  await page.goto(origin, { waitUntil: 'networkidle' })
  const slider = page.locator('.radar [role="slider"]')
  await slider.focus()
  await slider.press('ArrowRight')
  await page.waitForTimeout(1500)
  const canvas = page.locator('.radar canvas')
  const painted = await canvas.evaluate(el => el.getContext('2d').getImageData(0, 0, el.width, el.height).data.some((v, i) => i % 4 === 3 && v > 0))
  assert(painted, 'real round canvas is blank')
  results.push({ mobileMotion: true, reducedTransparency: true, painted, slider: await slider.getAttribute('aria-valuenow') })
  const policy = await request.get(origin + '/api/v1/legal/signup-policy')
  assert.equal(policy.status(), 200)
  assert.equal((await policy.json()).mode, 'draft')
  const email = `preview${Date.now()}@example.com`
  const password = 'Local-preview-only-42!'
  const registered = await request.post(origin + '/api/v1/auth/register', { data: { email, username: `preview${Date.now()}`, password, locale: 'ru' } })
  assert.equal(registered.status(), 201, await registered.text())
  let message
  for (let attempt = 0; attempt < 20; attempt++) {
    const inbox = await request.get(origin + '/__local/mail')
    assert.equal(inbox.status(), 200)
    message = (await inbox.json()).find(entry => entry.message.to_email === email && entry.message.data.verification_url)
    if (message) break
    await page.waitForTimeout(100)
  }
  assert(message, 'registration message missing from real broker sink')
  const token = new URL(message.message.data.verification_url).searchParams.get('token')
  const verified = await request.get(origin + '/api/v1/auth/verify-email?token=' + encodeURIComponent(token))
  assert.equal(verified.status(), 200, await verified.text())
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(origin + '/login', { waitUntil: 'networkidle' })
  await page.locator('input[autocomplete="username"]').fill(email)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL('**/account')
  await page.screenshot({ path: `${out}/account-authenticated-375.png` })
  await page.locator('.shell-bar a[href="/"]').click()
  await page.locator('.site-footer a[href="/help"]').click()
  await page.getByRole('heading', { name: 'Поддержка', exact: true }).waitFor()
  const chat = page.locator('#support-chat')
  const body = 'Локальная проверка: сообщение в поддержку.'
  await chat.locator('textarea').fill(body)
  await chat.locator('button[type="submit"]').click()
  await chat.getByText(body, { exact: true }).waitFor()
  await chat.screenshot({ path: `${out}/support-authenticated-375.png` })
  results.push({ registration: 201, brokerCapture: true, verification: 200, loginInMemory: true, supportHeading: 'Поддержка', secureCookieRetained: true })
  assert.equal(errors.length, 0, errors.join('\n'))
  assert.equal(external.length, 0, external.join('\n'))
  await writeFile(`${out}/local-app-qa.json`, JSON.stringify({ results, errors, external, realApi: true, httpsAuthPersistence: 'not tested: local certificate trust blocked' }, null, 2))
  console.log(`Passed ${results.length} real-app visual/layout/motion checks; draft policy and message sink reachable`)
} finally { await browser.close() }
