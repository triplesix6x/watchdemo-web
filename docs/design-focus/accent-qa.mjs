import { chromium } from '../../frontend/node_modules/playwright-core/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const output = new URL('./shots/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', chromiumSandbox: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto('http://127.0.0.1:4402/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-webgl="ready"]');
  // Isolate the real shader output from orange frame edges, static glows and copy.
  // These screenshot-only rules never change the prototype source or shader.
  await page.addStyleTag({ content: '.hero > :not(.focus-backdrop),.review-bar{visibility:hidden!important}.focus-backdrop:after,.fallback-contours{display:none!important}.focus-backdrop .topography-container{opacity:1!important}' });
  const snapshot = async name => page.screenshot({ path: new URL(`accent-${name}.png`, output).pathname });
  await snapshot('idle');
  await page.mouse.click(680, 620);
  await page.waitForTimeout(450);
  await snapshot('pulse');
  await page.waitForTimeout(9500);
  await snapshot('settled');
  const metrics = JSON.parse(execFileSync('python3', ['-c', `
from PIL import Image
from pathlib import Path
import json,sys
out={}
for name in ['idle','pulse','settled']:
 image=Image.open(Path(sys.argv[1])/('accent-'+name+'.png')).convert('RGB')
 out[name]=sum(1 for r,g,b in image.getdata() if r>45 and r>g*1.25 and r>b*1.25)
print(json.dumps(out))
`, output.pathname], { encoding: 'utf8' }));
  if (metrics.pulse < metrics.idle + 30 || metrics.settled > metrics.pulse * .1 + metrics.idle) throw new Error(`Transient orange crest failed: ${JSON.stringify(metrics)}`);
  await writeFile(new URL('accent-report.json', output), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify({ pass: true, orangePixels: metrics }));
} finally { await browser.close(); }
