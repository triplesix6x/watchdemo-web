import { chromium } from '../../frontend/node_modules/playwright-core/index.mjs';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const axe = await readFile(require.resolve('../../frontend/node_modules/axe-core/axe.min.js'), 'utf8');
const output = new URL('./shots/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', chromiumSandbox: true, headless: true });
const reports = [];
try {
  for (const width of [375, 390, 820, 1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.terrainTest = { draws: 0, maxBrush: 0, maxPulse: 0 };
      const names = new WeakMap();
      const prototype = WebGL2RenderingContext.prototype;
      const location = prototype.getUniformLocation;
      prototype.getUniformLocation = function(program, name) {
        const result = location.call(this, program, name);
        if (result) names.set(result, name);
        return result;
      };
      const uniform4f = prototype.uniform4f;
      prototype.uniform4f = function(location, x, y, z, w) {
        if (names.get(location) === 'uBrush') window.terrainTest.maxBrush = Math.max(window.terrainTest.maxBrush, w);
        return uniform4f.call(this, location, x, y, z, w);
      };
      const uniform4fv = prototype.uniform4fv;
      prototype.uniform4fv = function(location, values, ...rest) {
        if (names.get(location)?.startsWith('uPulses')) {
          for (let i = 3; i < values.length; i += 4) window.terrainTest.maxPulse = Math.max(window.terrainTest.maxPulse, values[i]);
        }
        return uniform4fv.call(this, location, values, ...rest);
      };
      const draw = prototype.drawArraysInstanced;
      prototype.drawArraysInstanced = function(...args) {
        window.terrainTest.draws++;
        return draw.apply(this, args);
      };
    });
    await page.goto('http://127.0.0.1:4402/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.terrainTest.draws > 1);
    const bounds = await page.locator('.hero').boundingBox();
    await page.mouse.move(width * .52, bounds.y + 200);
    await page.waitForFunction(() => window.terrainTest.maxBrush > .05);
    await page.getByRole('button', { name: 'Показать волну' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.terrainTest.maxPulse > .05);
    const effect = await page.evaluate(() => ({ ...window.terrainTest }));
    await page.mouse.move(width * .84, bounds.y + 210);
    await page.mouse.click(width * .84, bounds.y + 210);
    await page.waitForTimeout(400);
    await page.screenshot({ path: new URL(`${width}-live.png`, output).pathname, fullPage: true });
    await page.addScriptTag({ content: axe });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      brokenImages: [...document.images].filter(image => !image.complete || !image.naturalWidth).map(image => image.src),
      fonts: document.fonts.check('600 40px Onest'),
      gl: Boolean(document.querySelector('canvas')?.getContext('webgl2')),
    }));
    if (layout.overflow || layout.brokenImages.length || !layout.fonts || !layout.gl || errors.length || violations.length) throw new Error(JSON.stringify({ width, layout, errors, violations }));
    await page.getByRole('link', { name: /Скачать для Windows/ }).click();
    if (!page.url().endsWith('#notes')) throw new Error('Prototype CTA failed');
    await page.waitForTimeout(300);
    await page.setViewportSize({ width, height: 500 });
    await page.locator('#notes').evaluate(element => element.scrollIntoView());
    await page.waitForTimeout(500);
    const offscreen = await page.locator('.topography-container').evaluate(element => element.getBoundingClientRect().bottom <= 0);
    if (!offscreen) throw new Error(`Offscreen test did not leave the terrain at ${width}px`);
    const before = await page.evaluate(() => window.terrainTest.draws);
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => window.terrainTest.draws);
    if (after !== before) throw new Error(`Offscreen terrain drew after resize: ${before} ${after}`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => !document.querySelector('canvas'));
    await page.goto('http://127.0.0.1:4402/', { waitUntil: 'networkidle' });
    if (await page.locator('canvas').count()) throw new Error('Reduced motion still mounted WebGL');
    if (!await page.getByRole('button', { name: 'Показать волну' }).isDisabled()) throw new Error('Reduced motion pulse control enabled');
    await page.screenshot({ path: new URL(`${width}-reduced.png`, output).pathname, fullPage: true });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForSelector('canvas');
    await page.getByRole('button', { name: 'Статичный фон' }).click();
    await page.waitForFunction(() => !document.querySelector('canvas'));
    await page.getByRole('button', { name: 'Статичный фон' }).click();
    await page.waitForSelector('canvas');
    await page.evaluate(() => scrollTo(0, 0));
    const restored = await page.locator('canvas').evaluate(canvas => { const gl = canvas.getContext('webgl2'); return gl !== null && !gl.isContextLost() && gl.getError() === 0; });
    if (!restored) throw new Error('Restored WebGL context invalid');
    reports.push({ width, layout, errors, violations, effect, offscreenDraws: after - before, reducedMotion: true, restored });
    await page.close();
  }
  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await touch.addInitScript(() => {
    window.touchPulse = false;
    const names = new WeakMap();
    const prototype = WebGL2RenderingContext.prototype;
    const location = prototype.getUniformLocation;
    prototype.getUniformLocation = function(program, name) { const result = location.call(this, program, name); if (result) names.set(result, name); return result; };
    const uniform = prototype.uniform4fv;
    prototype.uniform4fv = function(location, values, ...rest) {
      if (names.get(location)?.startsWith('uPulses') && values[3] > .05) window.touchPulse = true;
      return uniform.call(this, location, values, ...rest);
    };
  });
  await touch.goto('http://127.0.0.1:4402/', { waitUntil: 'networkidle' });
  await touch.touchscreen.tap(350, 350);
  await touch.waitForFunction(() => window.touchPulse);
  const touchHint = await touch.locator('.touch-hint').isVisible();
  const session = await touch.context().newCDPSession(touch);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 12, y: 750 }] });
  for (let step = 1; step <= 8; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 12, y: 750 - step * 45 }] });
    await touch.waitForTimeout(30);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.waitForFunction(() => scrollY > 100);
  const touchScroll = await touch.evaluate(() => scrollY);
  if (!touchHint) throw new Error('Touch-specific instruction missing');
  await touch.screenshot({ path: new URL('touch-scroll.png', output).pathname });
  reports.push({ mobileTouch: true, nativeScroll: touchScroll, pulse: true, touchHint });
  await touch.close();
  const fallback = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await fallback.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.startsWith('webgl') ? null : getContext.call(this, type, ...args); };
  });
  await fallback.goto('http://127.0.0.1:4402/', { waitUntil: 'networkidle' });
  const fallbackImage = await fallback.locator('.fallback-contours').evaluate(element => getComputedStyle(element).backgroundImage);
  if (!fallbackImage.includes('terrain.svg')) throw new Error('No WebGL fallback missing');
  await fallback.screenshot({ path: new URL('no-webgl.png', output).pathname });
  reports.push({ noWebGL: true, fallbackImage });
  await writeFile(new URL('report.json', output), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify({ cases: reports.length, fails: [] }, null, 2));
} finally { await browser.close(); }
