// Two local-only visual candidates. Ordinary dist/index.html and its assets stay intact.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { localDiagnosticBootstrap } from './local-diagnostic-bootstrap.mjs'
import { matteTexture } from './matte-texture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const candidate = '/home/bigboss/.local/share/watchdemo-site-fixes-20261112/matte-prototypes/frontend'
const nativeLayer = process.argv.slice(2).includes('--native-layer')
const nativeGlass = nativeLayer || process.argv.slice(2).includes('--native-glass')
const visibleGlass = nativeGlass || process.argv.slice(2).includes('--glass-visible')
const glass = visibleGlass || process.argv.slice(2).includes('--glass')
assert(process.argv.slice(2).every(argument => ['--glass', '--glass-visible', '--native-glass', '--native-layer'].includes(argument)))
const directory = nativeLayer ? '__home-native-layer-20261113' : nativeGlass ? '__home-native-glass-20261113' : visibleGlass ? '__home-glass-visible-20261113' : glass ? '__home-glass-20261113' : '__home-matte-20261113-v2'
const variants = nativeLayer ? ['native-glass-layer'] : nativeGlass ? ['native-glass'] : visibleGlass ? ['matte-glass-visible'] : glass ? ['matte-glass'] : ['matte-texture', 'matte-live']
const container = JSON.parse(execFileSync('docker', ['inspect', 'watchdemo-local-frontend-1'], { encoding: 'utf8' }))[0]
assert.equal(container.Config.Labels['com.docker.compose.project'], 'watchdemo-local')
assert.equal(Object.keys(container.NetworkSettings.Networks).length, 1)
assert(container.HostConfig.Memory > 0 && container.HostConfig.NanoCpus > 0)
assert(Object.values(container.NetworkSettings.Ports ?? {}).every(value => value === null))
assert(container.Mounts.some(mount => mount.Destination === '/usr/share/nginx/html' && mount.Source === path.join(root, 'dist') && !mount.RW))
const ip = Object.values(container.NetworkSettings.Networks)[0].IPAddress
assert.match(ip, /^172\.\d+\.\d+\.\d+$/)
const origin = `https://${ip}:8443`
const ordinaryHtml = await readFile(path.join(root, 'dist/index.html'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const ordinaryAssets = [...ordinaryHtml.toString().matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map(match => match[1])
const baseline = Object.fromEntries(await Promise.all(ordinaryAssets.map(async asset => [asset, hash(await readFile(path.join(root, 'dist', asset)))])))
const out = path.join(root, 'dist', directory)
await mkdir(out) // Never replace an existing candidate silently.
const texture = matteTexture()
const manifest = { origin, baselineIndexSha256: hash(ordinaryHtml), textureBytes: texture.length, textureSha256: hash(texture), published: false, variants: [] }
for (const variant of variants) {
  let homeChanged = false, ghostResolved = false
  const live = !nativeGlass && variant !== 'matte-texture'
  const base = `/${directory}/${variant}/`
  const plugin = {
    name: 'local-matte-candidate', enforce: 'pre',
    resolveId(source, importer) {
      if (live && source.endsWith('/GhostFibers/GhostFibers') && importer?.includes('/features/backgrounds/')) {
        ghostResolved = true
        return path.join(candidate, 'src/features/backgrounds/GhostFibers/GhostFibers.tsx')
      }
    },
    transform(source, id) {
      if (!live || !id.split('?')[0].endsWith('/src/pages/Home.tsx')) return null
      const needle = '<div className="story-stage island">'
      assert.equal(source.split(needle).length, 2)
      homeChanged = true
      return { code: `import LocalLiveMatte from ${JSON.stringify(path.join(candidate, 'src/features/backgrounds/LocalLiveMatte.tsx'))};\n` + source.replace(needle, `${needle}<LocalLiveMatte />`), map: null }
    },
    buildEnd(error) { if (!error && live) assert(homeChanged && ghostResolved, 'Live candidate must use the isolated component and renderer') },
  }
  const css = `
html[data-local-diagnostic] .site-main:has(.home-background) .story-stage {
  background-color:#0d0f13;
  background-image:url('${base}matte.png');background-size:cover;background-position:center;
  backdrop-filter:none!important;box-shadow:none;isolation:auto;
}
.site-main:has(.home-background) .story-stage > .radar {position:relative;z-index:1}
.story-stage > .local-live-matte {position:absolute;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none;z-index:0}
.local-live-matte > div {width:100%;height:100%}
.local-live-matte canvas {display:block;width:100%;height:100%}
${nativeGlass ? `
html[data-local-diagnostic] .site-main:has(.home-background) .story-stage {
  background:rgb(13 15 19 / 0.56);
  -webkit-backdrop-filter:blur(12px) saturate(115%)!important;
  backdrop-filter:blur(12px) saturate(115%)!important;
}
@media (prefers-reduced-transparency:reduce), (forced-colors:active) {
  html[data-local-diagnostic] .site-main:has(.home-background) .story-stage {
    background:#0d0f13;
    -webkit-backdrop-filter:none!important;backdrop-filter:none!important;
  }
}` : ''}
${nativeLayer ? `
html[data-local-diagnostic] .site-main:has(.home-background) .story-stage {
  background:transparent;
  -webkit-backdrop-filter:none!important;backdrop-filter:none!important;
}
html[data-local-diagnostic] .site-main:has(.home-background) .story-stage::before {
  content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:0;
  background:rgb(13 15 19 / 0.56);
  -webkit-backdrop-filter:blur(12px) saturate(115%);
  backdrop-filter:blur(12px) saturate(115%);
  contain:paint;
}
@media (prefers-reduced-transparency:reduce), (forced-colors:active) {
  html[data-local-diagnostic] .site-main:has(.home-background) .story-stage::before {
    background:#0d0f13;-webkit-backdrop-filter:none;backdrop-filter:none;
  }
}` : ''}
${visibleGlass ? `
html[data-local-diagnostic] .site-main:has(.home-background) .story-stage {
  outline:1px solid rgb(190 207 230 / 0.17);
  box-shadow:inset 0 1px 0 rgb(255 255 255 / 0.045);
}
@media (min-width:900px) {
  html[data-local-diagnostic] .site-main:has(.home-background) .story-stage {
    width:94%;justify-self:center;
    --story-stage-height:min(calc((100svh - var(--header-h) - 2rem) * 0.94),calc((50cqw + 6rem) * 0.94));
  }
}` : ''}
`
  await build({ root, configFile: false, envFile: false, base, publicDir: false, define: { __MOCK__: 'false' },
    plugins: [plugin, react(), { name: 'local-matte-document', transformIndexHtml: { order: 'pre', handler: () => [
      { tag: 'script', children: localDiagnosticBootstrap(variant), injectTo: 'head-prepend' },
      { tag: 'style', children: css, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'robots', content: 'noindex,nofollow' }, injectTo: 'head' },
    ] } }], build: { outDir: path.join(out, variant), emptyOutDir: false, reportCompressedSize: false } })
  await writeFile(path.join(out, variant, 'matte.png'), texture)
  manifest.variants.push({ variant, url: `${origin}${base}index.html`, liveGpuCopy: live, algorithm: nativeGlass ? 'native-backdrop' : live ? 'dual-kawase' : 'static', candidateRendererSha256: live ? hash(await readFile(path.join(candidate, 'src/features/backgrounds/GhostFibers/GhostFibers.tsx'))) : null })
}
assert.equal(hash(await readFile(path.join(root, 'dist/index.html'))), manifest.baselineIndexSha256)
for (const [asset, expected] of Object.entries(baseline)) assert.equal(hash(await readFile(path.join(root, 'dist', asset))), expected)
await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify(manifest, null, 2))
