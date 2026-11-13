// Add CSS-only halves without changing the tested immutable JS bundle.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { surfaceAddbackStyle } from './home-surface-isolation.mjs'
import { replaceOnce } from './home-scroll-diagnostic-contract.mjs'
const directory = new URL('../dist/__home-diagnostic-20261113-surface/surface/', import.meta.url)
let html = await readFile(new URL('index.html', directory), 'utf8')
const modulePath = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1]
assert(modulePath?.endsWith('/index-BPmdQLJC.js'), 'Use the exact owner-tested surface bundle')
const js = await readFile(new URL('assets/index-BPmdQLJC.js', directory))
assert.equal(createHash('sha256').update(js).digest('hex'), '2d850d336a0e5b22fd4360b2244dea89842adea5df1741ae4baf1fb433715a31')
html = replaceOnce(html, "new URLSearchParams(location.search).get('surface') === 'flat' ? 'flat' : 'original'", "['flat','stage','background'].includes(new URLSearchParams(location.search).get('surface')) ? new URLSearchParams(location.search).get('surface') : 'original'")
html = replaceOnce(html, '</head>', `<style>${surfaceAddbackStyle}</style></head>`)
await writeFile(new URL('split.html', directory), html, { flag: 'wx' })
console.log(JSON.stringify({ modulePath, html: 'split.html', modes: ['original', 'flat', 'stage', 'background'], applicationJsChanged: false }))
