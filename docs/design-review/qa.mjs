import { chromium } from '../../frontend/node_modules/playwright-core/index.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:4401';
const output = new URL('./shots/', import.meta.url);
await mkdir(output, { recursive: true });
const axe = await readFile(new URL('../../frontend/node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', chromiumSandbox: true, headless: true });
const reports = [];
try {
  for (const concept of ['a', 'b', 'c']) {
    for (const width of [375, 390, 820, 1280, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
      await page.goto(`${base}/${concept}.html`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.addScriptTag({ content: axe });
      const accessibility = await page.evaluate(async () => {
        const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
        return result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }));
      });
      const metrics = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        missingImages: [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.src),
        font: getComputedStyle(document.querySelector('h1')).fontFamily,
      }));
      if (width === 1440 || width === 390) {
        await page.locator('.hero').screenshot({ path: new URL(`${concept}-${width === 1440 ? 'desktop' : 'mobile'}.png`, output).pathname });
        if (width === 1440) await page.locator('.study').screenshot({ path: new URL(`${concept}-app.png`, output).pathname });
      }
      reports.push({ concept, width, ...metrics, errors, accessibility });
      await page.close();
    }
  }
  for (const concept of ['a', 'b', 'c']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 1000 }, reducedMotion: 'reduce' });
    await page.goto(`${base}/${concept}.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.hero').screenshot({ path: new URL(`${concept}-reduced.png`, output).pathname });
    await page.locator('.product').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const keyboard = await page.locator('.product').evaluate(el => ({ focused: el === document.activeElement, scrollLeft: el.scrollLeft, outline: getComputedStyle(el).outlineStyle }));
    if (!keyboard.focused || !keyboard.scrollLeft || keyboard.outline === 'none') throw new Error(`Keyboard scroll/focus failed: ${concept} ${JSON.stringify(keyboard)}`);
    await page.locator('.product').screenshot({ path: new URL(`${concept}-keyboard.png`, output).pathname });
    reports.push({ concept, reducedMotion: true, keyboard });
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL('overview.png', output).pathname, fullPage: true });
  reports.push({ overview: true, brokenImages: await page.locator('img').evaluateAll(images => images.filter(i => !i.naturalWidth).map(i => i.src)) });
  await page.close();
  await writeFile(new URL('report.json', output), JSON.stringify(reports, null, 2));
  const fails = reports.filter(r => r.errors?.length || r.accessibility?.length || r.missingImages?.length || r.brokenImages?.length || r.scrollWidth > r.width);
  console.log(JSON.stringify({ cases: reports.length, fails }, null, 2));
  if (fails.length) process.exitCode = 1;
} finally { await browser.close(); }
