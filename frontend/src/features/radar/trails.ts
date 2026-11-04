import { position, type Frames, type Pose } from './round'

const STEP = 0.1
const LENGTH = 1.6
const POINTS = Math.floor(LENGTH / STEP) + 1

/** Cache each player's trail in a tightly cropped, pixel-aligned transparent layer.
 * Stationary players and deaths reuse their raster without changing the time source,
 * sample spacing, opacity, compositing order or resolution of the visible radar. */
export function createTrail(player: number, color: string, death: number) {
  const layer = document.createElement('canvas')
  const paint = layer.getContext('2d')!
  const points = new Float64Array(POINTS * 2).fill(NaN)
  const point: Pose = { x: 0, y: 0, yaw: 0 }
  let left = 0, top = 0, ratio = 0, width = 0
  let cached = false
  function stroke(target: CanvasRenderingContext2D, lineWidth: number) {
    target.lineCap = 'round'
    target.lineJoin = 'round'
    target.lineWidth = lineWidth
    target.strokeStyle = color
    for (let k = 1; k < POINTS; k++) {
      target.globalAlpha = 0.5 * (1 - k * STEP / LENGTH)
      target.beginPath()
      target.moveTo(points[(k - 1) * 2], points[(k - 1) * 2 + 1])
      target.lineTo(points[k * 2], points[k * 2 + 1])
      target.stroke()
    }
    target.globalAlpha = 1
  }

  return (ctx: CanvasRenderingContext2D, frames: Frames, t: number, size: number, dpr: number, lineWidth: number) => {
    let changed = ratio !== dpr || width !== lineWidth
    const until = Math.min(t, death)
    for (let k = 0; k < POINTS; k++) {
      position(frames, player, until - k * STEP, point)
      const x = point.x * size, y = point.y * size
      if (points[k * 2] !== x || points[k * 2 + 1] !== y) changed = true
      points[k * 2] = x
      points[k * 2 + 1] = y
    }
    if (changed) {
      ratio = dpr; width = lineWidth
      cached = false
      stroke(ctx, lineWidth)
      return
    }
    if (!cached) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let k = 0; k < POINTS; k++) {
        minX = Math.min(minX, points[k * 2]); maxX = Math.max(maxX, points[k * 2])
        minY = Math.min(minY, points[k * 2 + 1]); maxY = Math.max(maxY, points[k * 2 + 1])
      }
      const pad = lineWidth / 2 + 1
      left = Math.floor((minX - pad) * dpr)
      top = Math.floor((minY - pad) * dpr)
      layer.width = Math.max(1, Math.ceil((maxX + pad) * dpr) - left)
      layer.height = Math.max(1, Math.ceil((maxY + pad) * dpr) - top)
      paint.setTransform(dpr, 0, 0, dpr, -left, -top)
      stroke(paint, lineWidth)
      cached = true
    }
    ctx.drawImage(layer, left / dpr, top / dpr, layer.width / dpr, layer.height / dpr)
  }
}
