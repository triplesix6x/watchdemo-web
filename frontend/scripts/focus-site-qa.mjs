import { chromium } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8')
const base = new URL(process.env.FOCUS_SITE_URL ?? 'http://127.0.0.1:5173')
if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Local verification URLs only')
const output = process.env.FOCUS_SITE_OUTPUT ?? '/tmp/watchdemo-focus-site-qa'
await mkdir(output, { recursive: true })
const paths = [
  '/', '/en', '/download', '/en/download', '/pricing', '/en/pricing',
  '/help', '/en/help', '/changelog', '/en/changelog',
  '/login', '/en/login', '/register', '/forgot-password',
  '/account', '/en/account', '/account/security', '/account/profile',
  '/admin', '/admin/users', '/admin/support', '/admin/releases', '/admin/audit', '/admin/crashes',
  '/missing-focus-review', '/en/missing-focus-review',
]
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', chromiumSandbox: true })
const reports = [], failures = []
try {
  for (const path of paths) for (const width of (['/', '/en'].includes(path) ? [375, 390, 820, 1280, 1440] : [375, 1280])) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    const anonymous = /\/(login|register|forgot-password)$/.test(path)
    await page.addInitScript(persona => { localStorage.setItem('wd-mock-user', persona); localStorage.setItem('wd-mock-delay', '0') }, anonymous ? 'anon' : 'admin')
    page.on('pageerror', error => errors.push(error.message))
    const missingRoute = path.endsWith('/missing-focus-review')
    page.on('console', message => {
      const expectedDocument404 = missingRoute && message.location().url === new URL(path, base).href && message.text() === 'Failed to load resource: the server responded with a status of 404 (Not Found)'
      if (message.type() === 'error' && !expectedDocument404) errors.push(message.text())
    })
    try {
      const response = await page.goto(new URL(path, base).href, { waitUntil: 'networkidle' })
      const status = response.status()
      const statusOK = missingRoute ? (process.env.FOCUS_REQUIRE_404 === '1' ? status === 404 : [200, 404].includes(status)) : status === 200
      await page.evaluate(async () => {
        await document.fonts.ready
        // Below-the-fold lazy images are not broken merely because they have not loaded yet.
        await Promise.all([...document.images].map(image => {
          image.loading = 'eager'
          return image.decode().catch(() => {})
        }))
      })
      await page.waitForTimeout(400)
      await page.addScriptTag({ content: axe })
      const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })))
      const layout = await page.evaluate(() => ({
        actualPath: location.pathname,
        overflow: document.documentElement.scrollWidth > innerWidth,
        brokenImages: [...document.images].filter(image => !image.complete || !image.naturalWidth).map(image => image.src),
        forms: document.forms.length,
        hero: !!document.querySelector('.focus-hero'),
        terrain: !!document.querySelector('.focus-backdrop canvas'),
      }))
      const authStayed = !anonymous || (layout.actualPath === path && layout.forms > 0)
      const home = ['/', '/en'].includes(path)
      const clean = statusOK && !layout.overflow && !layout.brokenImages.length && !errors.length && !violations.length && authStayed && (home || !layout.terrain)
      const report = { path, width, status, persona: anonymous ? 'anon' : 'admin', layout, errors, violations, clean }
      reports.push(report)
      if (!clean) failures.push(report)
      const name = (path === '/' ? 'home-ru' : path.slice(1).replaceAll('/', '-')) + `-${width}`
      await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
    } catch (error) {
      const report = { path, width, error: String(error) }
      reports.push(report); failures.push(report)
    } finally { await page.close() }
  }
  // Mobile navigation must remain usable through keyboard and restore its trigger.
  const mobile = await browser.newPage({ viewport: { width: 375, height: 900 } })
  await mobile.goto(new URL('/en', base).href, { waitUntil: 'networkidle' })
  const menu = mobile.getByRole('button', { name: /menu$/i })
  await menu.focus(); await mobile.keyboard.press('Enter')
  await mobile.waitForFunction(() => document.querySelector('button[aria-expanded="true"]'))
  await mobile.keyboard.press('Escape')
  const navigation = await menu.evaluate(button => ({ collapsed: button.getAttribute('aria-expanded') === 'false', focused: document.activeElement === button }))
  reports.push({ mobileNavigation: navigation })
  if (!navigation.collapsed || !navigation.focused) failures.push({ mobileNavigation: navigation })
  await mobile.close()
  await writeFile(`${output}/report.json`, JSON.stringify(reports, null, 2))
  await writeFile(`${output}/failures.json`, JSON.stringify(failures, null, 2))
  console.log(JSON.stringify({ cases: reports.length, failures: failures.length, output }))
  if (failures.length) process.exitCode = 1
} finally { await browser.close() }
