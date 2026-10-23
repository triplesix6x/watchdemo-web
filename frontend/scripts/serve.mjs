// Serve dist/ the way nginx.conf does, for QA of a production or mock build:
//   npm run build:mock && node scripts/serve.mjs [port]
// SPA prefixes (plus /__ui, which only mock builds have) get app.html, prerendered paths
// their index.html, anything else the locale's 404 page with status 404. Text is gzipped
// as nginx does, so throttled timings match production. No /api proxy: use a mock build.
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const port = Number(process.argv[2] ?? 4400)
const SPA = /^\/(en\/)?(__ui|login|register|forgot-password|reset-password|verify-email|resend-verification|confirm-email-change|account|admin|dashboard|sessions)(\/|$)/
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' }

async function file(rel) {
  const p = path.join(dist, rel)
  if (!p.startsWith(dist)) return null
  try {
    return (await fs.stat(p)).isFile() ? p : null
  } catch {
    return null
  }
}

http
  .createServer(async (req, res) => {
    const uri = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let status = 200
    let hit = SPA.test(uri) ? await file('app.html') : uri === '/' ? await file('index.html') : (await file(uri)) ?? (await file(path.join(uri, 'index.html')))
    if (!hit) {
      status = 404
      hit = await file(/^\/en(\/|$)/.test(uri) ? 'en/404.html' : '404.html')
    }
    const type = TYPES[path.extname(hit)] ?? 'application/octet-stream'
    let body = await fs.readFile(hit)
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' }
    if (/text|javascript|json|xml|svg/.test(type) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
      body = gzipSync(body)
      headers['Content-Encoding'] = 'gzip'
    }
    res.writeHead(status, headers)
    res.end(body)
  })
  .listen(port, () => console.log(`dist on http://127.0.0.1:${port}`))
