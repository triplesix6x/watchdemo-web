import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const url = new URL(process.env.FOCUS_URL ?? 'http://127.0.0.1:4520/')
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Local verification URLs only')
const output = '/tmp/watchdemo-focus-accent'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', chromiumSandbox: true })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  await page.goto(url.href, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-webgl="ready"]')
  // Screenshot-only isolation: measure the real shader, not the warm frame or grounding.
  await page.addStyleTag({ content: '.focus-hero > :not(.focus-backdrop),.site-header{visibility:hidden!important}.focus-backdrop:after,.focus-contours{display:none!important}.focus-backdrop .topography-container{opacity:1!important}' })
  const snapshot = name => page.screenshot({ path: `${output}/${name}.png` })
  await snapshot('idle')
  await page.mouse.click(680, 620)
  await page.waitForTimeout(450)
  await snapshot('pulse')
  await page.waitForTimeout(9500)
  await snapshot('settled')
  const pixels = JSON.parse(execFileSync('python3', ['-c', `
from PIL import Image
from pathlib import Path
import json,sys
out={}
for name in ['idle','pulse','settled']:
 image=Image.open(Path(sys.argv[1])/(name+'.png')).convert('RGB')
 out[name]=sum(1 for r,g,b in image.getdata() if r>45 and r>g*1.25 and r>b*1.25)
print(json.dumps(out))
`, output], { encoding: 'utf8' }))
  if (pixels.pulse < pixels.idle + 30 || pixels.settled > pixels.pulse * .1 + pixels.idle) throw new Error(`Transient orange crest failed: ${JSON.stringify(pixels)}`)
  await writeFile(`${output}/report.json`, JSON.stringify({ pass: true, orangePixels: pixels }, null, 2))
  console.log(JSON.stringify({ pass: true, orangePixels: pixels }))
} finally { await browser.close() }
