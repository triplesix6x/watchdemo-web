// QA-only boundaries. No ambient/default Vite origin or automatic real API mode.
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const ORIGINS = Object.freeze({
  'mock-browser': 'http://127.0.0.1:4400',
  'isolated-backend': 'http://127.0.0.1:55440',
})

export function qaTarget(origin, mode = process.env.QA_MODE) {
  if (!Object.hasOwn(ORIGINS, mode) || origin !== ORIGINS[mode]) {
    throw Error('Explicit QA_MODE and exact isolated QA origin required')
  }
  return Object.freeze({ origin, mode })
}

export function requireRequestURL(value, target) {
  const url = new URL(value)
  if (url.username || url.password || url.origin !== target.origin || url.protocol !== 'http:') {
    throw Error('QA request outside declared origin')
  }
  if (target.mode === 'mock-browser' && /(?:^|\/)api(?:\/|$)/i.test(decodeURIComponent(url.pathname))) {
    throw Error('Mock browser must not contact an API proxy')
  }
  return url.href
}

// A fresh, external directory is mandatory; historical outputs cannot be selected.
export async function freshOutputDirectory(value = process.env.QA_OUTPUT_DIR, protectedRoots = []) {
  if (!value || !path.isAbsolute(value)) throw Error('Absolute external QA_OUTPUT_DIR required')
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const parent = await fs.realpath(path.dirname(value))
  const output = path.join(parent, path.basename(value))
  for (const root of [repo, ...protectedRoots]) {
    const relative = path.relative(await fs.realpath(root), output)
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
      throw Error('QA output must be outside every source and dependency repository')
    }
  }
  await fs.mkdir(output) // EEXIST deliberately rejects reuse, including symlinks.
  return output
}

export function guardedRequest(request, target) {
  const result = {}
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch']) {
    result[method] = async (url, options = {}) => {
      const safe = requireRequestURL(url, target)
      const response = await request[method](safe, { ...options, maxRedirects: 0 })
      if (response.status() >= 300 && response.status() < 400) {
        await response.dispose()
        throw Error('QA HTTP redirects are disabled')
      }
      return response
    }
  }
  return result
}

export async function guardContext(context, target, onReject = () => {}) {
  // No runner needs WebSockets; also closes a non-HTTP origin escape.
  await context.routeWebSocket('**/*', socket => {
    onReject(socket.url())
    socket.close()
  })
  // Service workers must be blocked at context creation, before the first page.
  await context.route('**/*', async route => {
    try {
      requireRequestURL(route.request().url(), target)
      // Redirected requests bypass Playwright routing. Never follow one here or
      // return one to the browser. Even same-origin redirects fail closed.
      const response = await route.fetch({ maxRedirects: 0 })
      if (response.status() >= 300 && response.status() < 400) {
        await response.dispose()
        throw Error('QA HTTP redirects are disabled')
      }
      await route.fulfill({ response })
      await response.dispose()
    } catch {
      onReject(route.request().url())
      await route.abort('blockedbyclient')
    }
  })
  // APIRequestContext does not use browser routes. Call only this wrapper.
  return guardedRequest(context.request, target)
}
