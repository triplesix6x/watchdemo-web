// Real Canvas2D parity and interleaved timing against the pre-redesign driver.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, stop } from 'esbuild'
import { chromium } from 'playwright-core'
const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.QA_OUTPUT_DIR
if (!out) throw Error('Set QA_OUTPUT_DIR')
await mkdir(out, { recursive: true })
async function bundle(source, globalName) {
  return (await build({ stdin: { contents: source + '\nexport {parseFrames} from "./round"; export {default as raw} from "../../assets/demo/mirage-r13.json";', resolveDir: path.join(frontend, 'src/features/radar'), loader: 'ts' }, bundle: true, format: 'iife', globalName, write: false, plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /\?url$/ }, () => ({ path: 'unused', namespace: 'url' })); b.onLoad({ filter: /.*/, namespace: 'url' }, () => ({ contents: 'export default "/unused"' })) } }] })).outputFiles[0].text
}
const before = execFileSync('git', ['show', '1ab4ab0:frontend/src/features/radar/driver.ts'], { cwd: frontend, encoding: 'utf8' })
const after = await readFile(path.join(frontend, 'src/features/radar/driver.ts'), 'utf8')
const bundles = [await bundle(before, 'Before'), await bundle(after, 'After')]
stop()
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || '/opt/google/chrome/chrome', chromiumSandbox: true, args: ['--disable-dev-shm-usage', '--disable-gpu', '--renderer-process-limit=1', '--js-flags=--max-old-space-size=96'] })
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 700 }, deviceScaleFactor: 2 })
  await page.setContent('<main></main>')
  await page.addScriptTag({ content: bundles[0] })
  await page.addScriptTag({ content: bundles[1] })
  const result = await page.evaluate(async () => {
    const roots = [0, 1].map(() => {
      const el = document.createElement('div')
      el.style.cssText = '--side-t:#eab308;--side-ct:#60a5fa;--danger:#f43f5e;display:inline-block'
      el.innerHTML = '<canvas style="width:320px;height:320px"></canvas><span data-clock></span><span data-rail></span><span data-fill></span><span role="slider"></span>'
      document.body.append(el)
      return el
    })
    const drivers = [Before.createDriver(roots[0], { idle: false, initial: 0 }), After.createDriver(roots[1], { idle: false, initial: 0 })]
    const frames = Before.parseFrames(Before.raw)
    drivers.forEach(d => d.load(frames))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const contexts = roots.map(r => r.querySelector('canvas').getContext('2d'))
    let worst = 0, differing = 0, total = 0
    const comparisons = [0, .001, .002, 15, 15.001, 26, 26.001, 31.9, 32, 45, 45.001, 55, 55.001, 64, 64.001, 74, 74.001, 26, 26.001]
    for (const time of comparisons) {
      drivers.forEach(d => { d.set(time); d.tick(0, 16.667) })
      const pixels = contexts.map(c => c.getImageData(0, 0, 640, 640).data)
      for (let i = 0; i < pixels[0].length; i += 4) {
        let delta = Math.abs(pixels[0][i + 3] - pixels[1][i + 3])
        for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(pixels[0][i + c] * pixels[0][i + 3] / 255 - pixels[1][i + c] * pixels[1][i + 3] / 255))
        worst = Math.max(worst, delta)
        if (delta > 1) differing++
        total++
      }
    }
    if (worst > 4 || differing / total > .001) throw Error(`Canvas parity failed: delta=${worst}, fraction=${differing / total}`)
    const timings = {}
    for (const scenario of ['whole-round', 'late-round']) {
      const sides = [[], []]
      for (let repeat = -1; repeat < 5; repeat++) for (const side of repeat % 2 === 0 ? [0, 1] : [1, 0]) {
        const started = performance.now()
        for (let frame = 0; frame < 120; frame++) {
          drivers[side].set(scenario === 'whole-round' ? frame * 74 / 120 : 55 + frame / 30)
          drivers[side].tick(0, 16.667)
          // Readback flushes pending Canvas2D work without allocating a full bitmap each frame.
          contexts[side].getImageData(0, 0, 1, 1)
        }
        if (repeat >= 0) sides[side].push((performance.now() - started) / 120)
      }
      timings[scenario] = { beforeMsPerFrame: sides[0], afterMsPerFrame: sides[1] }
    }
    // Untimed command census across every canvas, including cache generation.
    const originalStroke = CanvasRenderingContext2D.prototype.stroke
    const originalImage = CanvasRenderingContext2D.prototype.drawImage
    let strokes = 0, images = 0
    CanvasRenderingContext2D.prototype.stroke = function (...args) { strokes++; return originalStroke.apply(this, args) }
    CanvasRenderingContext2D.prototype.drawImage = function (...args) { images++; return originalImage.apply(this, args) }
    const census = drivers.map(d => {
      for (const t of [55, 55.001]) { d.set(t); d.tick(0, 16.667) }
      strokes = 0; images = 0
      d.set(55.002); d.tick(0, 16.667)
      return { strokes, images }
    })
    CanvasRenderingContext2D.prototype.stroke = originalStroke
    CanvasRenderingContext2D.prototype.drawImage = originalImage
    drivers.forEach(d => d.destroy())
    return { commandCensusAt55s: { before: census[0], after: census[1] }, canvas: '320 CSS px, DPR 2, software Canvas2D', comparisons: comparisons.length, maxPremultipliedChannelDelta: worst, pixelsDifferingOverOne: differing / total, timings }
  })
  await writeFile(path.join(out, 'radar-perf.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally { await browser.close() }
