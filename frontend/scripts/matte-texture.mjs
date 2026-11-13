// Offline, deterministic matte artwork. The browser receives a plain raster image:
// no SVG filters, CSS blur, animation, or runtime noise generation.
import { deflateSync } from 'node:zlib'

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}
function chunk(type, bytes) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])))
  return Buffer.concat([length, name, bytes, crc])
}

export function matteTexture() {
  const size = 384
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  const pixels = Buffer.alloc(size * (size * 3 + 1))
  let seed = 20261113
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1), v = y / (size - 1)
      let light = 0
      // Broad Gaussian ridges are the baked, already-soft image, not live blur.
      for (let line = 0; line < 7; line++) {
        const center = 0.12 + line * 0.15 + 0.14 * Math.sin(u * 3.1 + line * 0.7)
        const distance = (v - center) / (0.035 + line * 0.006)
        light += Math.exp(-distance * distance * 0.5) * (0.05 + line * 0.006)
      }
      const edge = 0.45 + 0.55 * Math.abs(u - 0.5) * 2
      const cloud = Math.exp(-((u - 0.18) ** 2 + (v - 0.22) ** 2) / 0.16) * 0.12
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const grain = (seed / 0xffffffff - 0.5) * 1.4
      const at = y * (size * 3 + 1) + 1 + x * 3
      const energy = light * edge + cloud
      for (let c = 0; c < 3; c++) {
        pixels[at + c] = Math.max(0, Math.min(255, Math.round([13, 15, 19][c] + [27, 56, 96][c] * energy + grain)))
      }
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
