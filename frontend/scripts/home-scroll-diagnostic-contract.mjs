// Diagnostic build transforms only: never imported by application code.
export const VARIANTS = ['normal', 'background-off', 'background-frozen', 'blur-off', 'background-hover-off', 'radar-off']
export function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw Error(`Diagnostic transform anchor must occur once: ${before}`)
  return source.replace(before, after)
}
export function diagnosticTransform(variant) {
  if (!VARIANTS.includes(variant)) throw Error(`Unknown variant: ${variant}`)
  const touched = []
  return {
    name: 'home-scroll-diagnostic-only', enforce: 'pre',
    transform(source, id) {
      id = id.split('?')[0].replaceAll('\\', '/')
      let result = source
      if (id.endsWith('/features/backgrounds/HomeBackground.tsx')) {
        if (variant === 'background-off') result = replaceOnce(source, 'allowed && visible &&', 'false && allowed && visible &&')
        if (variant === 'background-frozen') result = replaceOnce(source, 'speed={0.22}', 'paused speed={0.22}')
        if (variant === 'background-hover-off') result = replaceOnce(source, 'mouseInteraction pulseOnClick', 'mouseInteraction={false} pulseOnClick')
      }
      if (variant === 'blur-off' && id.endsWith('/features/backgrounds/home-background.css')) result = replaceOnce(source, 'backdrop-filter: blur(12px) saturate(115%);', 'backdrop-filter: none;')
      if (variant === 'radar-off' && id.endsWith('/features/radar/driver.ts')) result = replaceOnce(source, '    draw(t)\n', '    // Diagnostic only: preserve clock/timeline/subscriptions.\n')
      if (result !== source) { touched.push(id); return { code: result, map: null } }
      return null
    },
    buildEnd(error) {
      if (!error && variant !== 'normal' && touched.length !== 1) throw Error(`Variant ${variant} must transform exactly one module, got ${touched.length}`)
    },
  }
}
export function offscreenStatus({ width, scrollY, maximum, stage }) {
  if (!stage) throw Error('Radar stage missing from diagnostic workload')
  if (!stage.visible) return 'observed'
  // Desktop sticky geometry may keep the map visible even at the page boundary.
  // This is unavailable evidence, not a successful offscreen lifecycle check.
  if (width >= 900 && scrollY >= maximum - 2) return 'unavailable-at-document-end'
  throw Error('Real-input workload did not move radar offscreen')
}
export function frameSummary(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = p => sorted.length ? sorted[Math.floor((sorted.length - 1) * p)] : null
  return { count: sorted.length, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), worst: sorted.at(-1) ?? null, over33ms: sorted.filter(n => n > 33.34).length, over50ms: sorted.filter(n => n > 50).length }
}
export function orderSamples(repeats, entries) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 6) throw Error('--repeats must be 1..6 (1 is smoke only)')
  return Array.from({ length: repeats }, (_, repeat) => {
    const rotated = [...entries.slice(repeat % entries.length), ...entries.slice(0, repeat % entries.length)]
    return rotated.map(entry => ({ ...entry, repeat }))
  }).flat()
}
