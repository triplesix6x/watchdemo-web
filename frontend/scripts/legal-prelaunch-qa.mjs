// Coordinator only, serial and resource-limited. Start ONLY a VITE_MOCK_API=1 server first.
// This script never starts a server and blocks all API and external requests before navigation.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'

const origin = new URL(process.env.QA_ORIGIN ?? 'http://127.0.0.1:4540')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) && origin.protocol === 'http:' && !origin.username && !origin.password && origin.pathname === '/', 'QA_ORIGIN must be a plain localhost HTTP origin')
assert.equal(process.env.QA_MOCK_ONLY, '1', 'Explicit QA_MOCK_ONLY=1 confirmation required; ordinary Vite proxies production')
assert.ok(process.env.QA_OUTPUT_DIR, 'Set QA_OUTPUT_DIR to a persistent artifact directory')
const out = path.resolve(process.env.QA_OUTPUT_DIR)
await fs.mkdir(out, { recursive: true })
const catalog = JSON.parse(await fs.readFile(new URL('../src/content/legal.generated.json', import.meta.url), 'utf8'))
assert.ok(catalog.documents.every(d => d.status === 'draft'), 'This QA scenario is for the approved draft-only prelaunch bundle')
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js')
const report = []
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME ?? '/opt/google/chrome/chrome', chromiumSandbox: true })

async function open(context, route) {
  const page = await context.newPage()
  await page.goto(new URL(route, origin).href, { waitUntil: 'networkidle' })
  await page.locator('#curtain').waitFor({ state: 'hidden' })
  await page.evaluate(() => document.fonts.ready)
  return page
}
async function snapshot(page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: no horizontal overflow`)
  await page.screenshot({ path: path.join(out, `${name}.png`), animations: 'disabled' })
}
async function audit(page, name) {
  await page.addScriptTag({ path: axePath })
  const issues = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })))
  report.push({ name, accessibility: issues })
  assert.deepEqual(issues.filter(v => v.impact === 'critical' || v.impact === 'serious'), [], `${name}: serious/critical a11y violations`)
}
try {
  for (const width of [375, 1280]) for (const locale of ['ru', 'en']) {
    const lp = route => locale === 'en' ? `/en${route}` : route
    const blocked = []
    const errors = []
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true })
    // Defense in depth: never allow a mistaken non-mock app to reach Vite's API proxy.
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if ((url.protocol === 'http:' || url.protocol === 'https:') && (url.origin !== origin.origin || url.pathname.startsWith('/api/'))) {
        blocked.push(url.href)
        return route.abort('blockedbyclient')
      }
      return route.continue()
    })
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
    await context.addInitScript(() => {
      // axe creates opaque/about:blank frames where storage is unavailable.
      if (location.protocol !== 'http:') return
      localStorage.setItem('wd-mock-user', 'anon')
      localStorage.setItem('wd-mock-delay', '0')
    })
    try {
      const hub = await open(context, lp('/legal'))
      await hub.locator('.cookie-notice').waitFor()
      await snapshot(hub, `${width}-${locale}-legal-first-visit`)
      const settings = hub.locator('.cookie-notice button').first()
      await settings.click()
      const dialog = hub.getByRole('dialog')
      await dialog.waitFor()
      assert.equal(await dialog.locator('input[type="checkbox"], [role="switch"]').count(), 0, 'No fake analytics consent')
      assert.ok((await dialog.textContent()).includes(locale === 'en' ? 'not connected' : 'не подключена'))
      await snapshot(hub, `${width}-${locale}-cookie-settings`)
      await audit(hub, `${width}-${locale}-cookie-settings`)
      for (let i = 0; i < 8; i++) {
        await hub.keyboard.press('Tab')
        assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true, 'Focus stays in Dialog')
      }
      await hub.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await settings.evaluate(node => node === document.activeElement), true, 'Focus restored to settings opener')
      await hub.locator('.cookie-notice button').last().click()
      await hub.reload({ waitUntil: 'networkidle' })
      assert.equal(await hub.locator('.cookie-notice').count(), 0, 'Notice dismissal is remembered')
      assert.equal(await hub.locator('meta[name="robots"]').getAttribute('content'), 'noindex')
      assert.equal(await hub.locator('.legal-list li').count(), catalog.documents.length)
      await audit(hub, `${width}-${locale}-legal-hub`)
      await hub.close()
      for (const doc of catalog.documents) {
        for (const route of [`/legal/${doc.id}`, doc.url]) {
          const page = await open(context, lp(route))
          assert.equal(await page.locator('.legal-body').textContent(), doc.body, `${locale}${route}: exact original body`)
          assert.equal(await page.locator('.legal-body').getAttribute('lang'), 'ru')
          assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex')
          assert.equal(await page.locator('.legal-hash').textContent(), doc.sha256)
          if (route === doc.url) {
            const pending = page.waitForEvent('download')
            await page.getByRole('button', { name: locale === 'en' ? 'Download TXT' : 'Скачать TXT', exact: true }).click()
            const download = await pending
            const chunks = []
            for await (const chunk of await download.createReadStream()) chunks.push(chunk)
            const bytes = Buffer.concat(chunks)
            assert.deepEqual(bytes, Buffer.from(doc.body, 'utf8'), 'Download exact body, no BOM or newline rewrite')
            assert.equal(createHash('sha256').update(bytes).digest('hex'), doc.sha256)
          }
          if (doc.id === 'terms' && route === doc.url) {
            await snapshot(page, `${width}-${locale}-terms`)
            await audit(page, `${width}-${locale}-terms`)
            await page.emulateMedia({ media: 'print' })
            assert.equal(await page.locator('.legal-tools').isVisible(), false)
            assert.equal(await page.locator('.site-header').isVisible(), false)
            await snapshot(page, `${width}-${locale}-terms-print`)
          }
          await page.close()
        }
      }
      const pricing = await open(context, lp('/pricing'))
      await pricing.locator('.pr-table:visible, .pr-stack:visible').first().waitFor()
      assert.ok((await pricing.locator('.pr-head').textContent()).includes(locale === 'en' ? 'Sales are not open' : 'Продажи пока не открыты'))
      const ctas = pricing.locator('.pr-table tfoot a, .pr-stack .pr-block > a')
      for (const cta of await ctas.all()) assert.equal(await cta.getAttribute('href'), 'https://t.me/watchdemopro_bot', 'Guest test CTA uses existing Telegram support')
      await snapshot(pricing, `${width}-${locale}-pricing`)
      await audit(pricing, `${width}-${locale}-pricing`)
      await pricing.close()
      const register = await open(context, lp('/register'))
      const submit = register.locator('button[type="submit"]')
      await submit.waitFor({ state: 'visible' })
      await register.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
      assert.equal(await register.locator('input[type="checkbox"]').count(), 0, 'Draft signup adds no acceptance/age/Resend checkbox')
      assert.equal(await register.locator('.legal-email').count(), 1, 'One neutral service-email disclosure')
      await snapshot(register, `${width}-${locale}-register-draft`)
      await audit(register, `${width}-${locale}-register-draft`)
      await register.locator('input[type="email"]').fill('legal-qa@example.invalid')
      await register.locator('input[autocomplete="username"]').fill('legalqa')
      await register.locator('input[autocomplete="new-password"]').fill('FixturePass123')
      await register.evaluate(() => localStorage.setItem('wd-mock-legal-case', 'stale-register'))
      await submit.click()
      await register.getByRole('button', { name: locale === 'en' ? 'Reload signup policy' : 'Обновить условия регистрации', exact: true }).waitFor()
      assert.equal(await submit.isDisabled(), true)
      assert.equal(await register.locator('input[type="email"]').inputValue(), 'legal-qa@example.invalid')
      assert.equal(await register.locator('input[autocomplete="username"]').inputValue(), 'legalqa')
      assert.equal(await register.locator('input[autocomplete="new-password"]').inputValue(), 'FixturePass123', 'Draft-to-effective 422 does not discard form fields')
      await snapshot(register, `${width}-${locale}-register-stale`)
      await register.evaluate(() => localStorage.removeItem('wd-mock-legal-case'))
      await register.getByRole('button', { name: locale === 'en' ? 'Reload signup policy' : 'Обновить условия регистрации', exact: true }).click()
      await register.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
      await submit.click()
      await register.locator('.auth-actions').waitFor()
      await register.evaluate(() => localStorage.setItem('wd-mock-resend-fail', '1'))
      await register.locator('.auth-actions button').click()
      await register.locator('.auth-actions .note[data-tone="danger"]').waitFor()
      assert.equal(await register.locator('.auth-actions .note[data-tone="success"]').count(), 0, 'Failed resend never claims success')
      await register.evaluate(() => localStorage.removeItem('wd-mock-resend-fail'))
      await register.locator('.auth-actions button').click()
      await register.locator('.auth-actions .note[data-tone="success"]').waitFor()
      await register.close()
      for (const scenario of ['policy-error', 'enforced-unavailable']) {
        const page = await open(context, lp('/register'))
        await page.evaluate(value => localStorage.setItem('wd-mock-legal-case', value), scenario)
        await page.reload({ waitUntil: 'networkidle' })
        await page.locator('.signup-policy .note[data-tone="danger"]').waitFor()
        assert.equal(await page.locator('button[type="submit"]').isDisabled(), true, `${scenario}: fail closed`)
        assert.equal(await page.locator('input[type="checkbox"]').count(), 0, 'Draft bundled text never becomes acceptable')
        await snapshot(page, `${width}-${locale}-${scenario}`)
        await page.evaluate(() => localStorage.removeItem('wd-mock-legal-case'))
        await page.close()
      }
      const login = await open(context, lp('/login'))
      await login.locator('input[autocomplete="username"]').fill('unverified@example.invalid')
      await login.locator('input[autocomplete="current-password"]').fill('FixturePass123')
      await login.locator('button[type="submit"]').click()
      const loginResend = login.locator('.note button')
      await loginResend.waitFor()
      await login.evaluate(() => localStorage.setItem('wd-mock-resend-fail', '1'))
      await loginResend.click()
      await login.locator('.note span[role="alert"]').waitFor()
      assert.equal(await login.locator('.note[data-tone="success"]').count(), 0, 'Login failed resend never claims success')
      assert.equal(await login.locator('input[autocomplete="username"]').inputValue(), 'unverified@example.invalid')
      await login.evaluate(() => { localStorage.removeItem('wd-mock-resend-fail'); localStorage.setItem('wd-mock-unverified', '1') })
      await loginResend.click()
      await login.locator('.note[data-tone="success"]').waitFor()
      await login.close()
      const account = await open(context, `${lp('/account')}?mock-user=pro`)
      await account.locator('.tier-name').waitFor()
      assert.ok((await account.locator('.tier-name').textContent()).includes('Pro'))
      assert.ok(await account.locator(`a[href="${lp('/help')}#support-chat"]`).count() > 0, 'Authenticated test CTA opens existing chat')
      assert.equal(await account.locator('.legal-footer').count(), 1)
      await snapshot(account, `${width}-${locale}-account`)
      const accountResend = account.locator('.acc-grid > .note button')
      await accountResend.waitFor()
      await account.evaluate(() => localStorage.setItem('wd-mock-resend-fail', '1'))
      await accountResend.click()
      await account.locator('.acc-grid > .note span[role="alert"]').waitFor()
      assert.equal(await account.locator('.acc-grid > .note[data-tone="success"]').count(), 0, 'Overview failed resend never claims success')
      await account.evaluate(() => { localStorage.removeItem('wd-mock-resend-fail'); localStorage.removeItem('wd-mock-unverified') })
      await accountResend.click()
      await account.locator('.acc-grid > .note[data-tone="success"]').waitFor()
      await account.close()
      assert.deepEqual(blocked, [], 'Mock build must make zero API/external requests; all attempted requests were blocked')
      assert.deepEqual(errors, [], 'No page errors')
      report.push({ width, locale, passed: true })
    } finally { await context.close() }
  }
} finally {
  await fs.writeFile(path.join(out, 'legal-prelaunch-qa.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
console.log(`Legal prelaunch localhost mock QA artifacts: ${out}`)
