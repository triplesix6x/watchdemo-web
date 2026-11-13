// Diagnostic visual/command comparison. No readback timings are performance claims.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build, stop } from 'esbuild'
import { chromium } from 'playwright-core'

const before = process.env.QA_BASELINE_FRONTEND
const after = process.env.QA_CANDIDATE_FRONTEND
const output = process.env.QA_OUTPUT_DIR
assert(before && after && output, 'Set QA_BASELINE_FRONTEND, QA_CANDIDATE_FRONTEND, QA_OUTPUT_DIR')
assert(output.startsWith('/home/bigboss/.local/share/watchdemo-radar-layer-'), 'Use a dedicated persistent output prefix')
await mkdir(output, { recursive: false })
async function bundle(root, name) {
  return (await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server.browser';
    import {Radar} from './src/features/radar/Radar';
    export {createDriver} from './src/features/radar/driver';
    export {parseFrames,ROUND} from './src/features/radar/round';
    export {default as raw} from './src/assets/demo/mirage-r13.json';
    export const markup = () => renderToStaticMarkup(React.createElement(Radar, {alt:'QA map',caption:'QA',sliderLabel:'Round time'}));
  ` }, bundle: true, format: 'iife', globalName: name, write: false, jsx: 'automatic',
    nodePaths: [path.resolve('frontend/node_modules')],
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.BASE_URL': '"/"' },
    loader: { '.css': 'empty', '.webp': 'dataurl', '.png': 'dataurl' },
    plugins: [{ name: 'unused-fetch-url', setup(builder) {
      builder.onResolve({ filter: /\?url$/ }, () => ({ path: 'unused', namespace: 'unused' }))
      builder.onLoad({ filter: /.*/, namespace: 'unused' }, () => ({ contents: 'export default "/unused"' }))
    } }],
  })).outputFiles[0].text
}
const bundles = [await bundle(before, 'Before'), await bundle(after, 'After')]
const styles = [await readFile(path.join(before, 'src/features/radar/radar.css'), 'utf8'), await readFile(path.join(after, 'src/features/radar/radar.css'), 'utf8')]
stop()
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || '/home/bigboss/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: false,
  args: ['--disable-dev-shm-usage', '--renderer-process-limit=1', '--js-flags=--max-old-space-size=256'] })
const errors = []
const results = []
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: dpr })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => route.abort())
    await page.setContent('<main></main>')
    for (const source of bundles) await page.addScriptTag({ content: source })
    const result = await page.evaluate(async ({ styles, dpr }) => {
      const pause = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      // Readback switches Chromium's default backend heuristically. Pin BOTH
      // sides to the same CPU rasterizer for this pixel test; real-app GPU
      // scrolling is measured separately, without readbacks or this override.
      const nativeContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (kind, options) {
        return nativeContext.call(this, kind, kind === '2d' ? { ...options, willReadFrequently: true } : options)
      }
      const wrappers = styles.map((css, index) => {
        const host = document.createElement('section')
        document.body.append(host)
        const shadow = host.attachShadow({ mode: 'open' })
        shadow.innerHTML = `<style>${css}\n.radar{--side-t:#eab308;--side-ct:#60a5fa;--danger:#f43f5e;width:var(--qa-size);height:var(--qa-size);position:relative}.radar-view{width:100%;height:100%;position:relative;overflow:hidden}.radar-map,.radar-bar{display:none}.radar-canvas{position:absolute;inset:0;translate:none;width:100%;height:100%;mask-image:none;animation:none;transform:none}</style>` + (index ? After : Before).markup()
        return shadow.querySelector('.radar')
      })
      const drivers = wrappers.map((root, index) => (index ? After : Before).createDriver(root, { idle: false, initial: 0 }))
      drivers.forEach(driver => driver.load(Before.parseFrames(Before.raw)))
      const originalClear = CanvasRenderingContext2D.prototype.clearRect
      let cleared = 0
      CanvasRenderingContext2D.prototype.clearRect = function (x, y, w, h) {
        const m = this.getTransform()
        cleared += Math.abs(w * h * (m.a * m.d - m.b * m.c))
        return originalClear.call(this, x, y, w, h)
      }
      const cases = []
      const snapshots = []
      function pixels(root, size) {
        const result = document.createElement('canvas')
        result.width = result.height = Math.round(size * dpr)
        const ctx = result.getContext('2d')
        const rect = root.querySelector('.radar-canvas').getBoundingClientRect()
        for (const canvas of root.querySelectorAll('canvas')) {
          if (!canvas.width || !canvas.height || getComputedStyle(canvas).display === 'none') continue
          const box = canvas.getBoundingClientRect()
          ctx.globalAlpha = Number(getComputedStyle(canvas).opacity)
          ctx.drawImage(canvas, (box.x - rect.x) * dpr, (box.y - rect.y) * dpr, box.width * dpr, box.height * dpr)
        }
        return ctx.getImageData(0, 0, result.width, result.height).data
      }
      const times = [0, .001, 15, 26, 31.9, 32, 45, 55, 64, 74, 26, 0]
      for (const size of [320, 1000, 470]) {
        wrappers.forEach(root => root.style.setProperty('--qa-size', `${size}px`))
        await pause()
        for (const time of times) {
          const areas = []
          for (const driver of drivers) {
            cleared = 0
            driver.set(time)
            driver.tick(0, 1000 / 120)
            areas.push(cleared)
          }
          const images = wrappers.map(root => pixels(root, size))
          if (size === 320 && [0, 26, 45, 64].includes(time)) {
            snapshots.push({ size, time, images: images.map(data => {
              const canvas = document.createElement('canvas')
              canvas.width = canvas.height = Math.round(size * dpr)
              canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), canvas.width, canvas.height), 0, 0)
              return canvas.toDataURL('image/png').split(',')[1]
            }) })
          }
          let worst = 0, different = 0
          const largeDifferences = []
          for (let i = 0; i < images[0].length; i += 4) {
            let delta = Math.abs(images[0][i + 3] - images[1][i + 3])
            for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(images[0][i + c] * images[0][i + 3] / 255 - images[1][i + c] * images[1][i + 3] / 255))
            worst = Math.max(worst, delta)
            if (delta > 2) different++
            if (delta > 12 && largeDifferences.length < 12) largeDifferences.push({ x: (i / 4) % Math.round(size * dpr), y: Math.floor((i / 4) / Math.round(size * dpr)), before: [...images[0].slice(i, i + 4)], after: [...images[1].slice(i, i + 4)], delta })
          }
          cases.push({ size, time, worst, largeDifferences, fractionOverTwo: different / (images[0].length / 4), clearedPhysicalPixels: areas,
            canvasCount: wrappers.map(root => root.querySelectorAll('canvas').length),
            clock: wrappers.map(root => root.querySelector('[data-clock]').textContent),
          })
        }
      }
      HTMLCanvasElement.prototype.getContext = nativeContext
      CanvasRenderingContext2D.prototype.clearRect = originalClear
      drivers.forEach(driver => driver.destroy())
      await pause()
      return { dpr, cases, snapshots, remainingCanvases: wrappers.map(root => root.querySelectorAll('canvas').length) }
    }, { styles, dpr })
    for (const snapshot of result.snapshots) for (const [index, image] of snapshot.images.entries()) {
      await writeFile(path.join(output, `dpr${dpr}-size${snapshot.size}-time${snapshot.time}-${index ? 'after' : 'before'}.png`), Buffer.from(image, 'base64'))
    }
    delete result.snapshots
    results.push(result)
    await context.close()
  }
  await writeFile(path.join(output, 'parity.json'), JSON.stringify({ errors, results }, null, 2))
  assert.deepEqual(errors, [])
  for (const result of results) for (const item of result.cases) {
    assert.equal(item.clock[0], item.clock[1], `Clock at ${item.time}`)
    assert(item.worst <= 12 && item.fractionOverTwo < .005, `Visual mismatch DPR${result.dpr} size${item.size} time${item.time}: ${JSON.stringify(item)}`)
  }
  console.log(JSON.stringify({ dprs: results.map(result => result.dpr), cases: results.reduce((n, r) => n + r.cases.length, 0), errors }))
} finally {
  await browser.close()
}
