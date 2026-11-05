// Actual desktop Svelte components, isolated test transport, no external requests.
// Run inside run_limited_check_windows.py; no installed browser/profile is modified.
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
// This installed plugin exposes an import-only entry, not a require condition.
const pluginRoot = `${desktop}/node_modules/@sveltejs/vite-plugin-svelte`;
const pluginMetadata = JSON.parse(await fs.readFile(`${pluginRoot}/package.json`, 'utf8'));
const { svelte, vitePreprocess } = await import(pathToFileURL(path.resolve(pluginRoot, pluginMetadata.exports['.'].import.default)));
const { chromium } = requireFrontend('playwright-core');
const fixture = path.join(root, 'docs/browser-subscription');
const desktopTheme = (await import(pathToFileURL(`${desktop}/tailwind.config.js`))).default;
const tailwindcss = requireDesktop('tailwindcss');
const autoprefixer = requireDesktop('autoprefixer');
const artifacts = path.join(root, 'docs/qa/subscription-browser');
await fs.mkdir(artifacts, { recursive: true });
let browser;
const server = await createServer({
  configFile: false, envFile: false, root: desktop, clearScreen: false,
  css: { postcss: { plugins: [tailwindcss({ ...desktopTheme, content: [
    `${desktop}/src/**/*.{svelte,ts,js}`, `${fixture.replaceAll('\\', '/')}/**/*.{svelte,js}`,
  ] }), autoprefixer()] } },
  plugins: [svelte({ configFile: false, preprocess: vitePreprocess() }), {
    name: 'isolated-subscription-fixture',
    configureServer(instance) {
      instance.middlewares.use('/__qa__', (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="app"></div><script type="module" src="/@fs/${fixture.replaceAll('\\', '/')}/main.js"></script></html>`);
      });
    },
  }],
  optimizeDeps: { noDiscovery: true, include: ['svelte', 'svelte/transition', 'svelte/internal/client', 'esm-env'] },
  resolve: { alias: [{ find: '@desktop', replacement: `${desktop}/src` },
    { find: /^lucide-svelte$/, replacement: path.join(fixture, 'icons.js') }], dedupe: ['svelte'] },
  server: { host: '127.0.0.1', port: 55439, strictPort: true, hmr: false, watch: null,
    fs: { allow: [fixture, `${desktop}/src`, `${desktop}/node_modules`] } },
});
try {
  await server.listen();
  console.log(`QA census: ${Object.keys(server.watcher.getWatched()).length} watched directories; Node heap ${Math.round(process.memoryUsage().heapUsed / 1048576)} MiB before browser`);
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, chromiumSandbox: true,
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', reducedMotion: 'reduce' });
  const external = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:55439') return route.continue();
    external.push(url.origin);
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:55439/__qa__', { waitUntil: 'networkidle', timeout: 90000 });
  await page.getByText('Saved QA note', { exact: true }).waitFor();
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const call = (method, argument) => page.evaluate(([name, value]) => window.qa[name](value), [method, argument]);
  const edit = () => page.getByRole('button', { name: 'Edit', exact: true }).click();
  await edit();
  await page.locator('textarea').fill('Unsaved browser QA draft');
  await call('refresh'); await settle();
  assert.equal(await page.locator('textarea').inputValue(), 'Unsaved browser QA draft');
  await call('hide'); await page.locator('textarea').waitFor({ state: 'detached' });
  await call('show'); await page.getByText('Saved QA note', { exact: true }).waitFor();
  await edit();
  assert.equal(await page.locator('textarea').inputValue(), 'Unsaved browser QA draft');
  console.log('PASS mounted draft survives unchanged access refresh and unmount/remount');

  await call('hide'); await settle(); await call('fail', true); await call('show');
  await page.getByRole('alert').filter({ hasText: 'Could not load the saved note' }).waitFor();
  assert.equal(await page.locator('textarea').count(), 0);
  assert.deepEqual(await call('writes'), []);
  await call('fail', false);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByText('Saved QA note', { exact: true }).waitFor();
  await call('reactivate'); await settle(); await edit();
  assert.equal(await page.locator('textarea').inputValue(), 'Saved QA note');
  await page.locator('textarea').fill('Retired paid draft');
  await call('free'); await page.locator('textarea').waitFor({ state: 'detached' });
  assert.deepEqual(await call('writes'), []);
  console.log('PASS mounted read failure/retry, activation isolation and Free write retirement');

  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole('button', { name: 'Delete note', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /QA demo — named deletion/);
    assert.deepEqual(await call('writes'), []);
    for (let index = 0; index < 7; index++) {
      await page.keyboard.press('Tab');
      assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(artifacts, `note-confirm-${width}.png`) });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Delete note');
  }
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete note', exact: true }).click();
  await page.getByText('No notes yet.', { exact: true }).waitFor();
  assert.deepEqual(await call('writes'), ['']);
  console.log('PASS actual named confirmation, focus trap/Escape restore and Free deletion at 375/1280');

  await call('openImport');
  const importDialog = page.getByRole('dialog');
  await importDialog.waitFor();
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const submit = importDialog.getByRole('button', { name: 'Import selected', exact: true });
    assert.equal(await submit.isEnabled(), true);
    await submit.click();
    await page.getByRole('alert').filter({ hasText: 'Select at least one demo' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'FIELDSET');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(artifacts, `import-empty-${width}.png`) });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS actual empty import validation/focus at 375/1280; no page errors or external requests');
  await fs.writeFile(path.join(artifacts, 'result.txt'), 'PASS: mounted notes and empty-selection import checks; screenshots 375/1280. Test transport only; not native Tauri, WebAudio, complete app or staff reset proof.\n');
  console.log(`Screenshots: ${artifacts}`);
} finally {
  if (browser) await browser.close();
  await server.close();
  console.log('Isolated browser and Vite server stopped.');
}
