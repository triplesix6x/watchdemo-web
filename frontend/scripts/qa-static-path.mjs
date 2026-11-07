import path from 'node:path'

export function decodeRequestPath(raw) {
  // Decode before WHATWG URL normalization so encoded traversal is not hidden.
  const uri = decodeURIComponent(raw.split('?')[0])
  if (!uri.startsWith('/') || uri.includes('\0') || uri.includes('\\')) throw new URIError('Invalid request path')
  return uri
}

export function containedPath(root, relative) {
  const candidate = path.resolve(root, relative.replace(/^[/\\]+/, ''))
  const fromRoot = path.relative(root, candidate)
  if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) return null
  return candidate
}
