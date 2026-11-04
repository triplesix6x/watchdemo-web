import { chromium } from '../../frontend/node_modules/playwright-core/index.mjs';
import { mkdir } from 'node:fs/promises';
const output = new URL('./shots/', import.meta.url);
await mkdir(output, { recursive: true });
// Rejected premise: a halo on an isolated screenshot will integrate it with the scene.
// Compare full-scene lighting instead, on identical content and static terrain.
const studies = {
  ground: 'radial-gradient(ellipse 46% 25% at 73% 80%,rgba(252,115,77,.25),rgba(252,115,77,.09) 43%,transparent 100%)',
  crosslight: 'radial-gradient(ellipse 39% 48% at 50% 61%,rgba(252,115,77,.15),transparent 100%),radial-gradient(ellipse 38% 32% at 94% 38%,rgba(2,151,222,.09),transparent 100%)',
  basin: 'radial-gradient(ellipse 46% 32% at 72% 76%,rgba(252,115,77,.22),rgba(252,115,77,.075) 48%,transparent 100%),radial-gradient(ellipse 38% 38% at 88% 42%,rgba(2,7,10,.8),transparent 100%)',
};
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', chromiumSandbox: true });
try {
  for (const [name, light] of Object.entries(studies)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
    await page.goto('http://127.0.0.1:4402/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const original = await page.locator('.focus-backdrop').evaluate(element => getComputedStyle(element, ':after').backgroundImage);
    await page.addStyleTag({ content: `.focus-backdrop:after{background-image:${light},${original}}.product picture:before{content:"";position:absolute;inset:0;z-index:1;border-radius:inherit;pointer-events:none;background:linear-gradient(145deg,transparent 50%,rgba(252,115,77,.055) 100%)}` });
    await page.locator('.hero').screenshot({ path: new URL(`light-${name}.png`, output).pathname });
    await page.close();
  }
} finally { await browser.close(); }
