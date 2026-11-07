// Actual desktop AuthStore/AccountModal/LoginApp; only native/HTTP transport is simulated.
// Run sequentially inside run_limited_check_windows.py (1 GiB job, Node 256 MiB).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const desktop = 'D:/demo-manager';
const requireDesktop = createRequire(`${desktop}/package.json`);
const requireFrontend = createRequire(path.join(root, 'frontend/package.json'));
const { createServer } = await import(pathToFileURL(requireDesktop.resolve('vite')));
const pluginRoot = `${desktop}/node_modules/@sveltejs/vite-plugin-svelte`;
const metadata = JSON.parse(await fs.readFile(`${pluginRoot}/package.json`, 'utf8'));
const { svelte, vitePreprocess } = await import(pathToFileURL(path.resolve(pluginRoot, metadata.exports['.'].import.default)));
const { chromium } = requireFrontend('playwright-core');
const fixture = path.join(root, 'docs/browser-subscription');
const theme = (await import(pathToFileURL(`${desktop}/tailwind.config.js`))).default;
const artifacts = path.join(root, 'docs/qa/subscription-production-audit');
await fs.mkdir(artifacts, { recursive: true });
const server = await createServer({
  configFile: false, envFile: false, root: desktop, clearScreen: false,
  css: { postcss: { plugins: [requireDesktop('tailwindcss')({ ...theme, content: [
    `${desktop}/src/**/*.{svelte,ts,js}`, `${fixture.replaceAll('\\', '/')}/**/*.{svelte,js}`,
  ] }), requireDesktop('autoprefixer')()] } },
  plugins: [svelte({ configFile: false, preprocess: vitePreprocess() }), {
    name: 'desktop-access-production-regression',
    configureServer(instance) {
      instance.middlewares.use('/__qa_access__', (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="app"></div><script type="module" src="/@fs/${fixture.replaceAll('\\', '/')}/access-main.js"></script></html>`);
      });
    },
  }],
  optimizeDeps: { noDiscovery: true, include: ['svelte', 'svelte/transition', 'svelte/internal/client', 'esm-env'] },
  resolve: { alias: [
    { find: '@desktop', replacement: `${desktop}/src` },
    { find: /^lucide-svelte$/, replacement: path.join(fixture, 'icons-access.js') },
    { find: /^@tauri-apps\/api\/(event|window|app|core)$/, replacement: path.join(fixture, 'native-access-qa.js') },
  ], dedupe: ['svelte'] },
  server: { host: '127.0.0.1', port: 55441, strictPort: true, hmr: false, watch: null,
    fs: { allow: [fixture, `${desktop}/src`, `${desktop}/node_modules`] } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, chromiumSandbox: true,
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
  const context = await browser.newContext({ viewport: { width: 541, height: 800 }, locale: 'en-US', reducedMotion: 'reduce' });
  const external = [], errors = [], tiers = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:55441') return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => { errors.push(error.message); console.error('QA page error:', error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error('QA browser console:', message.text()); });
  await page.goto('http://127.0.0.1:55441/__qa_access__', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForFunction(() => Boolean(window.qaAccess));
  const call = (name, value) => page.evaluate(([method, argument]) => window.qaAccess[method](argument), [name, value]);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const tier of ['basic', 'plus', 'pro']) {
    await call('start', tier); await settle();
    await page.getByRole('dialog').waitFor();
    await page.waitForFunction(t => window.qaAccess.snapshot()?.tier === t, tier);
    assert.equal(await page.getByText('Quota information is unavailable', { exact: true }).count(), 0);
    for (const [label, caps] of [
      ['Demo imports', { basic: '0 / 5', plus: '0 / 15', pro: 'unlimited' }],
      ['New moment sets', { basic: '0 / 1', plus: '0 / 2', pro: 'unlimited' }],
      ['Groups', { basic: '0 / 2', plus: '0 / 5', pro: 'unlimited' }],
    ]) {
      await page.getByText(label, { exact: true }).locator('..').getByText(caps[tier], { exact: true }).waitFor();
    }
    const initial = await call('counts');
    assert.ok(initial.access <= 2, `Unbounded bootstrap/account requests: ${JSON.stringify(initial)}`);
    await call('burst'); await call('localBurst'); await settle();
    const afterEvents = await call('counts');
    assert.ok(afterEvents.access - initial.access <= 1, `Duplicate event burst: ${JSON.stringify(afterEvents)}`);
    await call('refresh'); await settle();
    const afterRefresh = await call('counts');
    assert.ok(afterRefresh.access - afterEvents.access <= 1, `Refreshes not coalesced: ${JSON.stringify(afterRefresh)}`);
    await page.waitForTimeout(1200); // Observe an idle window; not request polling.
    assert.deepEqual(await call('counts'), afterRefresh);
    assert.equal((await call('snapshot')).tier, tier);
    tiers.push({ tier, initial, afterEvents, afterRefresh });
    await page.screenshot({ path: path.join(artifacts, `quota-${tier}.png`) });
  }
  console.log('PASS actual AuthStore + AccountModal: Basic/Plus/Pro counters installed; bounded event/refresh bursts and idle requests');
  await call('login'); await page.locator('.login-card').waitFor();
  for (const width of [375, 491, 1280]) {
    await page.setViewportSize({ width, height: 572 });
    for (const locale of ['ru', 'en']) {
      await page.locator('.language-button').filter({ hasText: new RegExp(`^${locale}$`, 'i') }).click();
      await settle();
      const buttons = page.locator('.login-chrome button');
      assert.equal(await buttons.count(), 4);
      for (const button of await buttons.all()) {
        const box = await button.boundingBox();
        assert.ok(box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width);
        assert.ok(await button.getAttribute('aria-label'));
        assert.equal(await button.getAttribute('data-tauri-drag-region'), null);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(artifacts, `login-${locale}-${width}.png`) });
    }
  }
  await page.locator('.login-window-actions button').nth(0).focus();
  await page.keyboard.press('Enter');
  await page.locator('.login-window-actions button').nth(1).focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await call('nativeCalls'), { minimize: 1, close: 1 });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS actual login chrome: RU/EN 375/491/1280, geometry/labels/keyboard/native-call routing; no external requests or page exceptions');
  await fs.writeFile(path.join(artifacts, 'browser-result.json'), JSON.stringify({ tiers, loginViewports: [375, 491, 1280],
    pageErrors: errors, externalRequests: external, scope: 'Actual Svelte stores/components, simulated native transport. Not a native Tauri window or live backend/browser composition.' }, null, 2) + '\n');
} finally {
  if (browser) await browser.close();
  await server.close();
  console.log('Isolated access/chrome browser and server stopped.');
}
