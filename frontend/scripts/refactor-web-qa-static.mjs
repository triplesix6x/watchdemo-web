// W1-only production build and static transport. Never serves source or dependencies.
import fs from 'node:fs/promises'
import path from 'node:path'
import { decodeRequestPath, containedPath } from './qa-static-path.mjs'
import { ORIGIN, SCENARIOS, requireURL } from './refactor-web-qa-contract.mjs'

export function staticBuildConfig(frontend, deps, output, dependencies) {
  return {
    configFile: false, envFile: false, envPrefix: [], mode: 'production', base: '/', root: frontend,
    cacheDir: path.join(output, 'vite-cache'),
    esbuild: { jsx: 'automatic' },
    css: { postcss: { plugins: [] } }, // Do not discover an ambient PostCSS config.
    define: { __MOCK__: 'true' },
    resolve: { alias: dependencies.map(find => ({ find, replacement: path.join(deps, 'node_modules', find).replaceAll('\\', '/') })), dedupe: ['react', 'react-dom'] },
    build: {
      outDir: path.join(output, 'site'), emptyOutDir: false, manifest: true,
      rollupOptions: { input: { site: path.join(frontend, 'index.html'), mounted: path.join(frontend, 'scripts/refactor-web-qa-mounted.tsx') } },
    },
  }
}

function assetURL(file) {
  if (typeof file !== 'string' || !file || file.split('/').some(part => !part || part === '.' || part === '..') || /[\\?#\u0000]/.test(file) || path.isAbsolute(file)) throw Error('Invalid built asset path')
  return '/' + file.split('/').map(encodeURIComponent).join('/')
}

export function mountedHTML(manifest) {
  const entries = Object.entries(manifest).filter(([key, value]) => value?.isEntry && (value.src ?? key) === 'scripts/refactor-web-qa-mounted.tsx')
  if (entries.length !== 1) throw Error('Expected exactly one built mounted entry')
  const [key, entry] = entries[0]
  const seen = new Set(), css = new Set()
  function visit(id) {
    if (seen.has(id)) return
    seen.add(id)
    const chunk = manifest[id]
    if (!chunk) throw Error(`Missing built manifest import: ${id}`)
    for (const imported of chunk.imports ?? []) visit(imported)
    for (const file of chunk.css ?? []) css.add(assetURL(file))
  }
  visit(key)
  return '<!doctype html><html><head><meta charset="utf-8">' + [...css].map(url => `<link rel="stylesheet" href="${url}">`).join('') + `</head><body><div id="root"></div><script type="module" src="${assetURL(entry.file)}"></script></body></html>`
}

const spaPaths = new Set(SCENARIOS.filter(c => c.url !== '/__refactor-mounted.html').flatMap(c => {
  const pathname = new URL(c.url, ORIGIN).pathname
  return c.id === 'controls' ? [pathname] : [pathname, '/en' + (pathname === '/' ? '/' : pathname)]
}))
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
}

// Returns bytes/status separately from HTTP so offline tests exercise the actual
// responder, including realpath containment, without opening a listener.
export async function staticResponse(root, { method, host, url }) {
  if (host !== new URL(ORIGIN).host) return { status: 403 }
  if (!['GET', 'HEAD'].includes(method)) return { status: 405, headers: { Allow: 'GET, HEAD' } }
  let pathname
  try {
    if (!url?.startsWith('/') || url.startsWith('//') || url.includes('#')) throw new URIError('Invalid request target')
    pathname = decodeRequestPath(url)
    if (pathname.split('/').some(part => part === '..' || part === '.')) return { status: 403 }
    requireURL(new URL(url, ORIGIN).href)
  } catch { return { status: 400 } }
  const candidate = containedPath(root, pathname)
  if (!candidate || await fs.realpath(root) !== root) return { status: 403 }
  async function read(file) {
    let canonical
    try { canonical = await fs.realpath(file) } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null
      throw error
    }
    if (containedPath(root, path.relative(root, canonical)) !== canonical) return { status: 403 }
    if (!(await fs.stat(canonical)).isFile()) return null
    return { status: 200, headers: { 'Content-Type': mime[path.extname(canonical).toLowerCase()] ?? 'application/octet-stream' }, body: method === 'HEAD' ? undefined : await fs.readFile(canonical) }
  }
  const file = await read(candidate)
  if (file) return file
  if (spaPaths.has(pathname)) return await read(path.join(root, 'index.html')) ?? { status: 404 }
  return { status: 404 }
}

export function staticHandler(root) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      const result = await staticResponse(root, { method: request.method, host: request.headers.host, url: request.url })
      response.writeHead(result.status, result.headers).end(result.body)
    } catch { response.writeHead(500).end() }
  }
}
