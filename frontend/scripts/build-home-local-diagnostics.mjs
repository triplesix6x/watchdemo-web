// Local-only single-factor builds of the real app. Never imported by application code.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { diagnosticTransform, replaceOnce } from './home-scroll-diagnostic-contract.mjs'
import { isolationVariants, compositionVariants, isolationStyle, motionIsolation } from './home-motion-isolation.mjs'
import { radarLayerCandidate, radarWebglCandidate } from './radar-layer-candidate.mjs'
import { localDiagnosticBootstrap } from './local-diagnostic-bootstrap.mjs'
import { homeDomQuarantine } from './home-dom-quarantine.mjs'
import { surfaceIsolationStyle } from './home-surface-isolation.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const container = JSON.parse(execFileSync('docker', ['inspect', 'watchdemo-local-frontend-1'], { encoding: 'utf8' }))[0]
assert.equal(container.Config.Labels['com.docker.compose.project'], 'watchdemo-local')
assert.equal(Object.keys(container.NetworkSettings.Networks).length, 1)
assert(container.HostConfig.Memory > 0 && container.HostConfig.NanoCpus > 0)
assert(Object.values(container.NetworkSettings.Ports ?? {}).every(value => value === null))
assert(container.Mounts.some(mount => mount.Destination === '/usr/share/nginx/html' && mount.Source === path.join(root, 'dist') && !mount.RW))
const ip = Object.values(container.NetworkSettings.Networks)[0].IPAddress
assert.match(ip, /^172\.\d+\.\d+\.\d+$/)
const origin = `https://${ip}:8443`
assert(process.argv.length <= 3 && process.argv.slice(2).every(argument => ['--radar-block-off', '--radar-mask-off', '--static-reference', '--css-effects-off', '--bounded-motion', '--motion-isolation', '--composition-isolation', '--radar-layers', '--radar-webgl', '--dom-commit', '--surface'].includes(argument)))
const surface = process.argv.includes('--surface')
const domCommit = process.argv.includes('--dom-commit')
const radarWebgl = process.argv.includes('--radar-webgl')
const radarLayers = process.argv.includes('--radar-layers')
const blockOff = process.argv.includes('--radar-block-off')
const maskOff = process.argv.includes('--radar-mask-off')
const staticReference = process.argv.includes('--static-reference')
const cssEffectsOff = process.argv.includes('--css-effects-off')
const boundedMotion = process.argv.includes('--bounded-motion')
const composeMotion = process.argv.includes('--composition-isolation')
const isolateMotion = process.argv.includes('--motion-isolation') || composeMotion
const directory = surface ? '__home-diagnostic-20261113-surface' : domCommit ? '__home-diagnostic-20261113-dom' : radarWebgl ? '__home-diagnostic-20261113-webgl' : radarLayers ? '__home-diagnostic-20261113-layers-v2' : composeMotion ? '__home-diagnostic-20261113-composition' : isolateMotion ? '__home-diagnostic-20261113-isolation' : blockOff ? '__home-diagnostic-20261112-block-off' : maskOff ? '__home-diagnostic-20261112-mask-off' : staticReference ? '__home-diagnostic-20261112-static' : cssEffectsOff ? '__home-diagnostic-20261112-css-effects-off' : boundedMotion ? '__home-diagnostic-20261112-bounded-motion' : '__home-diagnostic-20261112'
const out = path.join(root, 'dist', directory)
await mkdir(out) // Fresh directory only; rebuilding the app removes these local artifacts.
const variants = surface ? ['surface'] : domCommit ? ['dom-commit'] : radarWebgl ? ['radar-webgl'] : radarLayers ? ['radar-layers'] : composeMotion ? compositionVariants : isolateMotion ? isolationVariants : blockOff ? ['radar-block-off'] : maskOff ? ['radar-mask-off'] : staticReference ? ['static-reference'] : boundedMotion ? ['bounded-motion'] : ['normal', 'blur-off', 'radar-off', 'background-off', 'native-scroll']
const manifest = { origin, accepting: false, mockApi: false, variants: [], sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }
if (staticReference || cssEffectsOff) {
  // Reuse the actual prerender. These document controls need no bundler.
  const source = await readFile(path.join(root, 'dist', 'index.html'), 'utf8')
  assert(source.includes('story-stage') && source.includes('radar-canvas'))
  const variant = staticReference ? 'static-reference' : 'css-effects-off'
  let html = staticReference ? source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*rel="modulepreload"[^>]*>/gi, '') : source
  html = html.replace('</head>', '<style>*,*::before,*::after{animation:none!important;transition:none!important;backdrop-filter:none!important;mask-image:none!important}</style></head>')
  if (staticReference) assert(!/<script\b/i.test(html))
  else html = html.replace('<head>', `<head><script>history.replaceState(null,'','/?localDiagnostic=${variant}')</script>`)
  await mkdir(path.join(out, variant))
  await writeFile(path.join(out, variant, 'index.html'), html)
  manifest.variants.push({ variant, url: `${origin}/${directory}/${variant}/index.html`, applicationScripts: !staticReference })
} else for (const variant of variants) {
  const { build } = await import('vite')
  const { default: react } = await import('@vitejs/plugin-react')
  let nativeTransforms = 0
  const plugin = domCommit || surface ? homeDomQuarantine() : radarWebgl ? radarWebglCandidate() : radarLayers ? radarLayerCandidate() : isolateMotion ? motionIsolation(variant) : variant === 'bounded-motion' ? {
    name: 'local-bounded-motion', enforce: 'pre',
    transform(source, id) {
      id = id.split('?')[0].replaceAll('\\', '/')
      let code = source
      if (id.endsWith('/features/radar/driver.ts')) {
        code = replaceOnce(code, 'const nextDpr = Math.min(devicePixelRatio || 1, 2)', 'const nextDpr = Math.min(devicePixelRatio || 1, 2, 1024 / Math.max(1, r.width, r.height))')
        code = replaceOnce(code, '  let dirty = true', '  let dirty = true\n  let renderDeadline: number | null = null\n  let pendingDeltaMs = 0')
        code = replaceOnce(code, '    const dt = Math.min(deltaMs, 100) / 1000', `    pendingDeltaMs += deltaMs
    const now = _time * 1000, intervalMs = 1000 / 60
    if (!dirty && renderDeadline !== null && now + 0.5 < renderDeadline) return
    renderDeadline = renderDeadline === null || now - renderDeadline > intervalMs ? now + intervalMs : renderDeadline + intervalMs
    const dt = Math.min(pendingDeltaMs, 100) / 1000
    pendingDeltaMs = 0`)
        code = replaceOnce(code, 'gsap.ticker.deltaRatio()', 'dt * 60')
      }
      if (id.endsWith('/features/backgrounds/GhostFibers/cadence.ts')) code = replaceOnce(code, 'const intervalMs = 1000 / 60', 'const intervalMs = 1000 / 30')
      if (code === source) return null
      nativeTransforms++
      return { code, map: null }
    },
    buildEnd(error) { if (!error) assert.equal(nativeTransforms, 2) },
  } : variant === 'radar-block-off' ? {
    name: 'local-entire-radar-block-off', enforce: 'pre',
    transform(source, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/pages/Home.tsx')) return null
      nativeTransforms++
      let code = replaceOnce(source, '  useStory(storyRef, radarRef)', '  // Local diagnostic: no story driver or timeline listeners are mounted.')
      code = replaceOnce(code, '        <div className="story-stage island">', '        {false && <div className="story-stage island">')
      code = replaceOnce(code, '        </div>\n      </section>', '        </div>}\n      </section>')
      return { code, map: null }
    },
    buildEnd(error) { if (!error) assert.equal(nativeTransforms, 1) },
  } : variant === 'radar-mask-off' ? {
    name: 'local-radar-mask-off', enforce: 'pre',
    transform(source, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/features/radar/radar.css')) return null
      nativeTransforms++
      return { code: replaceOnce(source, 'mask-image: radial-gradient(circle at 50% 50%, #000 var(--veil), transparent calc(var(--veil) + 16%));', 'mask-image: none;'), map: null }
    },
    buildEnd(error) { if (!error) assert.equal(nativeTransforms, 1) },
  } : variant === 'native-scroll' ? {
    name: 'local-native-scroll-diagnostic', enforce: 'pre',
    transform(source, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/engine/scroll.ts')) return null
      nativeTransforms++
      return { code: replaceOnce(source, '  lenis = new Lenis({', '  native = true\n  return\n  lenis = new Lenis({'), map: null }
    },
    buildEnd(error) { if (!error) assert.equal(nativeTransforms, 1) },
  } : diagnosticTransform(variant)
  // Keep imports based under the diagnostic directory, but boot the router at the
  // real home URL. This avoids API mocks, separate servers and artificial layouts.
  const bootstrap = localDiagnosticBootstrap(variant)
  await build({
    root, configFile: false, envFile: false, base: `/${directory}/${variant}/`,
    publicDir: false, define: { __MOCK__: 'false' },
    plugins: [plugin, react(), { name: 'local-diagnostic-bootstrap', transformIndexHtml: {
      order: 'pre', handler: () => [
        { tag: 'script', children: bootstrap, injectTo: 'head-prepend' },
        ...(surface ? [{ tag: 'style', children: surfaceIsolationStyle, injectTo: 'head' }] : []),
        ...(isolateMotion ? [{ tag: 'style', children: variant === 'effects-only' ? 'html.motion [data-split],html.motion [data-reveal]{visibility:visible!important}' : isolationStyle, injectTo: 'head' }] : []),
        ...(staticReference ? [{ tag: 'style', children: '*,*::before,*::after{animation:none!important;transition:none!important;backdrop-filter:none!important;mask-image:none!important}', injectTo: 'head' }] : []),
      ],
    } }],
    build: { outDir: path.join(out, variant), emptyOutDir: false, reportCompressedSize: false },
  })
  const html = await readFile(path.join(out, variant, 'index.html'), 'utf8')
  assert(html.includes(bootstrap))
  manifest.variants.push({ variant, url: `${origin}/${directory}/${variant}/index.html`, ...(radarLayers || radarWebgl ? { candidateHashes: plugin.hashes } : {}) })
}
await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
await writeFile(path.join(out, 'index.html'), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Локальная диагностика главной</title><body style="font:18px/1.6 system-ui;max-width:800px;margin:3rem auto;padding:1rem;background:#0d0f13;color:#eee"><h1>Локальная диагностика главной</h1><p>Это не варианты исправления. Каждая сборка меняет ровно один фактор текущего сайта. API и геометрия настоящие. Возвращайтесь к этому списку кнопкой браузера «Назад», не обновлением главной.</p><ol>${manifest.variants.map(({ variant, url }) => `<li><a style="color:#7eb1f7" href="${url}">${variant}</a></li>`).join('')}</ol><p>normal — контроль; blur-off — без размытия корпуса; radar-off — без рисования игроков/следов, с прежним таймлайном; background-off — без WebGL-фона; native-scroll — нативная прокрутка вместо Lenis; radar-block-off — полностью без DOM-блока карты, таймлайна, sticky-корпуса и story driver (геометрия мобильной страницы при этом меняется).</p><p>Сравнивайте в одном браузере, при одинаковом масштабе и одинаковой прокрутке. Уберите остальные вкладки с анимацией из видимости.</p></body></html>`)
console.log(JSON.stringify(manifest, null, 2))
