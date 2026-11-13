// Mount the production banner; only the public HTTP boundary is simulated.
// Run via docs/scripts/run_limited_check_windows.py; no external requests allowed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '../.qa-artifacts/maintenance');
await fs.mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: false, envFile: false,
  plugins: [{ name: 'maintenance-fixture', configureServer(instance) {
    instance.middlewares.use('/__maintenance_qa__', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#10131b;color:#eee;font-family:Arial,sans-serif;--page-pad:24px;--t-s:14px}header{height:72px;border-bottom:1px solid #292d38;display:flex;align-items:center;padding:0 24px}main{padding:24px}button{font:inherit}</style><header>WATCHDEMO</header><div id="root"></div><main><h1>Ваши демозаписи</h1><p>Содержимое сайта остаётся доступным.</p><a href="#content">Открыть демозаписи</a></main><script type="module" src="/scripts/fixtures/maintenance.tsx"></script></html>`);
    });
  } }],
  define: { __MOCK__: 'false' },
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { include: ['react', 'react-dom/client', 'react-router-dom'] },
  server: { host: '127.0.0.1', port: 55442, strictPort: true, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  let mode = 'short';
  const texts = { short: 'Технические работы · Обновляем сервис. Ваши демозаписи в безопасности.', long: 'Проводим плановые технические работы. Некоторые функции могут быть временно недоступны. '.repeat(5) };
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:55442') return route.abort();
    if (url.pathname.endsWith('/maintenance-notice')) {
      if (mode === 'error') return route.fulfill({ status: 503, body: '{}' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: mode !== 'off', text: texts[mode] ?? '' }) });
    }
    return route.continue();
  });
  const open = async (value, width = 1280, motion = 'no-preference') => {
    mode = value;
    await page.setViewportSize({ width, height: 720 });
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto('http://127.0.0.1:55442/__maintenance_qa__', { waitUntil: 'networkidle' });
  };
  for (const width of [375, 768, 1280]) {
    for (const content of ['short', 'long']) {
      await open(content, width);
      await page.locator('.maintenance-banner').waitFor();
      assert.equal(await page.locator('.maintenance-banner-text').textContent(), texts[content]);
      const geometry = await page.evaluate(() => {
        const box = document.querySelector('.maintenance-banner').getBoundingClientRect();
        const track = document.querySelector('.maintenance-track');
        return { x: box.x, right: box.right, width: box.width, scroll: document.documentElement.scrollWidth, viewport: innerWidth,
          duration: parseFloat(getComputedStyle(track).animationDuration), play: getComputedStyle(track).animationPlayState,
          vp: (() => { const el = document.querySelector('.maintenance-viewport');const css=getComputedStyle(el);return {width:el.clientWidth,scroll:el.scrollWidth,overflow:css.overflow,position:css.position}; })(),
          overflow: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth).map(el => ({ tag: el.tagName, cls: el.className, right: el.getBoundingClientRect().right })) };
      });
      assert.ok(geometry.x > 0 && geometry.right < width && geometry.scroll <= width, JSON.stringify({ width, content, geometry }));
      assert.ok(geometry.duration >= 24);
      assert.equal(await page.locator('.maintenance-banner button').count(), 0);
      assert.ok(await page.locator('.maintenance-banner').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
      const treatment = await page.locator('.maintenance-banner').evaluate(el => {
        const before = getComputedStyle(el, '::before');
        const after = getComputedStyle(el, '::after');
        const style = getComputedStyle(el);
        return { left: before.left, right: after.right, width: before.width, height: before.height,
          sameTape: before.backgroundImage === after.backgroundImage, tape: before.backgroundImage,
          background: style.backgroundImage, border: style.borderTopColor, shadow: style.boxShadow,
          mask: getComputedStyle(el.querySelector('.maintenance-viewport')).maskImage };
      });
      assert.equal(treatment.left, '0px');
      assert.equal(treatment.right, '0px');
      assert.equal(treatment.width, '8px');
      assert.ok(parseFloat(treatment.height) > 40);
      assert.ok(treatment.sameTape && treatment.tape.includes('-45deg'));
      assert.ok(treatment.background.includes('rgb(219, 183, 44)') && treatment.background.includes('rgb(212, 174, 36)'));
      assert.equal(treatment.border, 'rgb(242, 214, 109)');
      assert.notEqual(treatment.shadow, 'none');
      assert.ok(treatment.mask.includes('linear-gradient') && treatment.mask.includes('24px'));
      const track = page.locator('.maintenance-track');
      const initial = await track.evaluate(el => getComputedStyle(el).transform);
      await page.locator('.maintenance-banner').hover();
      await page.waitForTimeout(250);
      assert.equal(await track.evaluate(el => getComputedStyle(el).animationPlayState), 'running');
      assert.notEqual(await track.evaluate(el => getComputedStyle(el).transform), initial);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(output, `${content}-${width}.png`) });
    }
  }
  await open('long', 375, 'reduce');
  assert.equal(await page.locator('.maintenance-track').isVisible(), false);
  assert.equal(await page.locator('.maintenance-banner button').count(), 0);
  assert.equal(await page.locator('.maintenance-viewport').evaluate(el => getComputedStyle(el).maskImage), 'none');
  const staticText = await page.locator('.maintenance-banner-text').evaluate(el => ({ height: el.clientHeight, align: getComputedStyle(el).textAlign, scroll: document.documentElement.scrollWidth }));
  assert.ok(staticText.height > 20 && staticText.align === 'center' && staticText.scroll <= 375);
  await page.screenshot({ path: path.join(output, 'reduced-motion-375.png') });
  await open('off');
  assert.equal(await page.locator('.maintenance-banner').count(), 0);
  await open('error');
  assert.equal(await page.locator('.maintenance-banner').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS production MaintenanceBanner: 375/768/1280, short/long, larger type/hazard tape, continuous motion on hover/no pause, reduced motion, disabled/error; screenshots:', output);
} finally {
  await browser?.close();
  await server.close();
}
