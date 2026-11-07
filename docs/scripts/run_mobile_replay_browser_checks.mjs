// Actual Home + Radar + production CSS. No production service requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const frontend = path.join(root, 'frontend');
const require = createRequire(path.join(frontend, 'package.json'));
const vitePackage = require.resolve('vite/package.json');
const metadata = JSON.parse(await fs.readFile(vitePackage, 'utf8'));
const { createServer } = await import(pathToFileURL(path.resolve(path.dirname(vitePackage), metadata.exports['.'].import.default)));
const { chromium } = require('playwright-core');
const fixture = path.join(root, 'docs/browser-subscription/home.jsx').replaceAll('\\', '/');
const origin = 'http://127.0.0.1:55442';
const artifacts = path.join(root, 'docs/qa/subscription-production-audit');
await fs.mkdir(artifacts, { recursive: true });
const server = await createServer({
  configFile: false, envFile: false, root: frontend, clearScreen: false,
  define: { __MOCK__: 'false' }, esbuild: { jsx: 'automatic' },
  resolve: { dedupe: ['react', 'react-dom', 'react-router-dom'] },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-router-dom', 'gsap', 'gsap/ScrollTrigger', 'lenis', 'lucide-react'] },
  plugins: [{ name: 'mobile-home-qa', configureServer(instance) {
    instance.middlewares.use('/__homeqa__', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(await instance.transformIndexHtml('/__homeqa__', `<html lang="ru"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/@fs/${fixture}"></script></body></html>`));
    });
  } }],
  server: { host: '127.0.0.1', port: 55442, strictPort: true, hmr: false, watch: null,
    fs: { allow: [path.join(root, 'docs/browser-subscription'), frontend] } },
});
let browser;
const errors = [], external = [], results = [];
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
    chromiumSandbox: true, args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
  const context = await browser.newContext({ reducedMotion: 'reduce', locale: 'ru-RU' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.href); return route.abort(); }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  for (const width of [375, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`${origin}/__homeqa__`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.locator('.story-stage .radar').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.evaluate(() => {
      const rect = element => { const { x, y, width, height, right } = element.getBoundingClientRect(); return { x, y, width, height, right }; };
      return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
        stage: rect(document.querySelector('.story-stage')), radar: rect(document.querySelector('.story-stage .radar')),
        copy: rect(document.querySelector('.story-copy')) };
    });
    assert.ok(geometry.pageWidth <= width, JSON.stringify(geometry));
    if (width < 900) {
      assert.ok(Math.abs(geometry.stage.x) <= 1 && Math.abs(geometry.stage.right - width) <= 1, JSON.stringify(geometry));
      const left = geometry.radar.x - geometry.stage.x;
      const right = geometry.stage.right - geometry.radar.right;
      assert.ok(Math.abs(left - right) <= 1 && left >= 15, JSON.stringify({ left, right, geometry }));
    } else {
      assert.ok(geometry.stage.x > geometry.copy.x && geometry.stage.right <= width + 1, JSON.stringify(geometry));
    }
    results.push({ width, ...geometry });
    await page.screenshot({ path: path.join(artifacts, `mobile-replay-${width}.png`) });
    console.log(`PASS actual Home/Radar alignment: ${width}px, frame x=${geometry.stage.x.toFixed(1)}..${geometry.stage.right.toFixed(1)}, no page overflow`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await fs.writeFile(path.join(artifacts, 'mobile-replay-result.json'), JSON.stringify({ results, pageErrors: errors, externalRequests: external,
    scope: 'Actual Home/Radar/CSS in sandboxed Chromium; simulated HTTP and reduced motion. Not physical iOS Safari.' }, null, 2) + '\n');
} finally {
  if (browser) await browser.close();
  await server.close();
  console.log('Isolated mobile replay browser and server stopped.');
}
