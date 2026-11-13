// Focused comparison of the preserved smooth control and ordinary homepage.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
const container = JSON.parse(execFileSync('docker', ['inspect', 'watchdemo-local-frontend-1'], { encoding: 'utf8' }))[0]
assert.equal(container.Config.Labels['com.docker.compose.project'], 'watchdemo-local')
assert.equal(Object.keys(container.NetworkSettings.Networks).length, 1)
assert(container.HostConfig.Memory > 0 && container.HostConfig.NanoCpus > 0)
assert(Object.values(container.NetworkSettings.Ports ?? {}).every(value => value === null))
const ip = Object.values(container.NetworkSettings.Networks)[0].IPAddress
assert.match(ip, /^172\.\d+\.\d+\.\d+$/)
const origin = `https://${ip}:8443`
const output = process.env.QA_OUTPUT_DIR
assert(output?.startsWith('/home/bigboss/.local/share/watchdemo-smooth-compare-'))
await mkdir(output)
const browser = await chromium.launch({ headless: false, executablePath: '/home/bigboss/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' })
const errors = [], rejected = [], results = []
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, serviceWorkers: 'block' })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (rejected.push(route.request().url()), route.abort()))
  for (const [name, path] of [['ordinary', '/'], ['smooth-control', '/__home-diagnostic-20261113-surface/surface/index.html?surface=original']]) {
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin + path, { waitUntil: 'networkidle' })
    await page.locator('.home-background-effect canvas').waitFor()
    await page.waitForTimeout(4000)
    const snapshot = await page.evaluate(() => {
      const selectors = ['html', 'body', '.site-main', '.home-background', '.home-background-effect', '.home-background-effect canvas', '.home-background-shade', '.story', '.story-stage', '.radar', '.radar-view', '.radar-map', '.radar-canvas', '.radar-rail', '.radar-fill']
      const properties = ['display', 'position', 'width', 'height', 'top', 'left', 'transform', 'translate', 'scale', 'opacity', 'filter', 'backdrop-filter', 'mask-image', 'isolation', 'z-index', 'contain', 'will-change', 'overflow', 'background-color', 'mix-blend-mode', 'font-family', 'font-size']
      return {
        url: location.href, module: document.querySelector('script[type="module"]').getAttribute('src'), fonts: document.fonts.status,
        rootNodes: document.querySelector('#root').querySelectorAll('*').length,
        commentNodes: (() => { const walker = document.createTreeWalker(document.querySelector('#root'), NodeFilter.SHOW_COMMENT); let n = 0; while (walker.nextNode()) n++; return n })(),
        elements: Object.fromEntries(selectors.map(selector => { const element = document.querySelector(selector); if (!element) return [selector, null]; const css = getComputedStyle(element), r = element.getBoundingClientRect(); return [selector, { classes: element.className, rect: [r.x, r.y, r.width, r.height], css: Object.fromEntries(properties.map(key => [key, css.getPropertyValue(key)])), canvas: element instanceof HTMLCanvasElement ? [element.width, element.height] : null }] })),
      }
    })
    results.push({ name, ...snapshot })
    await page.close()
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(rejected, [])
  const differences = []
  for (const [selector, before] of Object.entries(results[0].elements)) {
    const after = results[1].elements[selector]
    for (const key of ['classes', 'rect', 'canvas']) if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) differences.push({ selector, key, ordinary: before?.[key], control: after?.[key] })
    for (const [key, value] of Object.entries(before?.css ?? {})) if (after?.css[key] !== value) differences.push({ selector, key, ordinary: value, control: after?.css[key] })
  }
  await writeFile(`${output}/result.json`, JSON.stringify({ performanceConclusion: false, results, differences, errors, rejected }, null, 2))
  console.log(JSON.stringify({ output, roots: results.map(({ name, rootNodes, commentNodes, module }) => ({ name, rootNodes, commentNodes, module })), differences }, null, 2))
} finally { await browser.close() }
