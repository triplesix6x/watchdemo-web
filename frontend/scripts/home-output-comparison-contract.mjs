// This report is diagnostic: timing evidence never grants visual acceptance.
export const WORKLOAD = Object.freeze({ width: 390, height: 844, dpr: 1, seed: 240621, warmupMs: 2000, phaseMs: 2000, phases: ['idle', 'scroll-down', 'offscreen-idle', 'scroll-reentry'] })
// A normal scroll traversal starts native lazy images before decode readiness.
// Keep the function self-contained: Playwright serializes it into the real page.
export async function warmHomepageImages() {
  const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight)
  for (let top = 0; top < maximum; top += innerHeight) {
    window.scrollTo({ top, behavior: 'instant' })
    await new Promise(requestAnimationFrame)
  }
  window.scrollTo({ top: maximum, behavior: 'instant' })
  await new Promise(requestAnimationFrame)
  window.scrollTo({ top: 0, behavior: 'instant' })
  await new Promise(requestAnimationFrame)
}
export function sampleOrder(repeats) {
  if (!Number.isInteger(repeats) || repeats < 3 || repeats > 6) throw Error('Explicit --repeats integer 3..6 required')
  // Two independent unchanged-baseline contexts per candidate context. Rotate
  // candidate position to expose warm-cache/thermal/order effects, not hide them.
  return Array.from({ length: repeats }, (_, repeat) =>
    (repeat % 3 === 0 ? ['baseline', 'baseline', 'candidate'] : repeat % 3 === 1 ? ['baseline', 'candidate', 'baseline'] : ['candidate', 'baseline', 'baseline'])
      .map((source, slot) => ({ repeat, slot, source }))).flat()
}
export function hardwareGPU(gpu) {
  if (!gpu?.renderer || !gpu.unmaskedRenderer || /swiftshader|software|llvmpipe|basic render|warp/i.test(gpu.unmaskedRenderer)) throw Error('Identified hardware WebGL renderer required; software runs are not performance evidence')
  return gpu
}
export function summarize(samples) {
  const metrics = ['p50FrameMs', 'p95FrameMs', 'longFrames', 'taskDurationMs', 'scriptDurationMs', 'layoutDurationMs']
  const groups = Object.fromEntries(['baseline', 'candidate'].map(source => [source, samples.filter(s => s.source === source)]))
  if (groups.baseline.length !== groups.candidate.length * 2 || groups.candidate.length < 3) throw Error('Incomplete repeated whole-home comparison')
  const median = values => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 }
  const report = {}
  for (const metric of metrics) {
    const baseline = groups.baseline.map(s => s.metrics[metric]), candidate = groups.candidate.map(s => s.metrics[metric])
    if (![...baseline, ...candidate].every(Number.isFinite)) throw Error(`Missing finite metric: ${metric}`)
    report[metric] = { baseline, candidate, baselineMedian: median(baseline), candidateMedian: median(candidate), baselineRange: Math.max(...baseline) - Math.min(...baseline), medianDelta: median(candidate) - median(baseline) }
  }
  return { accepting: false, conclusion: 'Diagnostic only: inspect raw repeats/order/CPU and baseline noise; no proven speedup or visual equivalence is inferred.', metrics: report }
}
