// Diagnostic-only add-back census. Application modules are never edited.
import assert from 'node:assert/strict'
import { replaceOnce } from './home-scroll-diagnostic-contract.mjs'

export const isolationVariants = ['motion-none', 'motion-story', 'motion-background', 'motion-engine']
export const compositionVariants = ['motion-all', 'motion-story-background', 'effects-only']
export const isolationStyle = `*,*::before,*::after{animation:none!important;transition:none!important;backdrop-filter:none!important;mask-image:none!important}html.motion [data-split],html.motion [data-reveal]{visibility:visible!important}`

export function motionIsolation(variant) {
  assert([...isolationVariants, ...compositionVariants].includes(variant))
  const transformed = new Set()
  const story = ['motion-story', 'motion-story-background', 'motion-all'].includes(variant)
  const background = ['motion-background', 'motion-story-background', 'motion-all'].includes(variant)
  const engine = ['motion-engine', 'motion-all'].includes(variant)
  const expected = new Set([
    ...(!story ? ['story'] : []),
    ...(!background ? ['background'] : []),
    ...(!engine ? ['reveals', 'scroll'] : []),
  ])
  return {
    name: `local-${variant}`, enforce: 'pre',
    transform(source, moduleId) {
      const id = moduleId.split('?')[0].replaceAll('\\', '/')
      let code = source
      let actor
      if (id.endsWith('/features/home/useStory.ts') && expected.has('story')) {
        code = replaceOnce(code, '  usePage(() => {', '  return // Diagnostic: keep radar DOM but mount no story driver.\n  usePage(() => {')
        actor = 'story'
      } else if (id.endsWith('/features/backgrounds/HomeBackground.tsx') && expected.has('background')) {
        // Preserve the static background layers and their dimensions.
        code = replaceOnce(code, '{allowed && visible && <Suspense', '{false && allowed && visible && <Suspense')
        actor = 'background'
      } else if (id.endsWith('/engine/reveal.ts') && expected.has('reveals')) {
        code = replaceOnce(code, "  gsap.registerPlugin(ScrollTrigger, SplitText)", "  return gsap.timeline({ paused: true }) // Diagnostic: no split/reveal/parallax wiring.\n  gsap.registerPlugin(ScrollTrigger, SplitText)")
        actor = 'reveals'
      } else if (id.endsWith('/engine/scroll.ts') && expected.has('scroll')) {
        code = replaceOnce(code, '  lenis = new Lenis({', '  native = true\n  return // Diagnostic: native input, no Lenis clock.\n  lenis = new Lenis({')
        actor = 'scroll'
      }
      if (!actor) return null
      transformed.add(actor)
      return { code, map: null }
    },
    buildEnd(error) { if (!error) assert.deepEqual([...transformed].sort(), [...expected].sort()) },
  }
}
