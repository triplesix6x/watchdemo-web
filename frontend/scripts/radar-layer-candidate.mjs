// Local-only renderer candidate. Application sources are not modified.
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

export function radarLayerCandidate() {
  return candidate('/home/bigboss/.local/share/watchdemo-site-fixes-20261112/performance/frontend/src/features/radar',
    ['driver.ts', 'trails.ts', 'renderer.ts', 'Radar.tsx', 'radar.css'], 'local-radar-layer-candidate')
}

export function radarWebglCandidate() {
  return candidate('/home/bigboss/.local/share/watchdemo-site-fixes-20261112/radar-webgl/frontend/src/features/radar',
    ['driver.ts', 'webgl.ts'], 'local-radar-webgl-candidate')
}

function candidate(root, files, name) {
  const hashes = Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')]))
  const used = new Set()
  return {
    name, enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null
      const target = path.resolve(path.dirname(importer.split('?')[0]), source)
      if (path.basename(path.dirname(target)) !== 'radar') return null
      const file = files.find(file => target.endsWith(`/${file}`) || target.endsWith(`/${file.replace(/\.(ts|tsx)$/, '')}`))
      if (!file) return null
      used.add(file)
      return path.join(root, file)
    },
    buildEnd(error) { if (!error) assert.equal(used.size, files.length, `Candidate modules: ${[...used]}`) },
    hashes,
  }
}
