// Local experiment only: identical graphics and calculations, optional DOM commits.
import assert from 'node:assert/strict'
import { replaceOnce } from './home-scroll-diagnostic-contract.mjs'

export function homeDomQuarantine() {
  const changed = new Set()
  return {
    name: 'local-home-dom-quarantine', enforce: 'pre',
    transform(source, id) {
      id = id.split('?')[0].replaceAll('\\', '/')
      let code = source
      if (id.endsWith('/features/radar/driver.ts')) {
        code = `const localCensus = { attempted: 0, committed: 0, ticks: 0, draws: 0, resizes: 0, backingChanges: 0 }
Reflect.set(window, '__localDomCensus', localCensus)
const localCommitsEnabled = document.documentElement.dataset.localDomCommits !== 'off'
export function localDomCommit() {
  localCensus.attempted++
  if (localCommitsEnabled) localCensus.committed++
  return localCommitsEnabled
}
` + code
        const edits = [
          ['rail.style.translate = `${(p * 100).toFixed(3)}% 0`', 'const translate = `${(p * 100).toFixed(3)}% 0`; if (localDomCommit()) rail.style.translate = translate'],
          ['fill.style.scale = `${p.toFixed(4)} 1`', 'const scale = `${p.toFixed(4)} 1`; if (localDomCommit()) fill.style.scale = scale'],
          ['clockEl.textContent = clock(t)', 'const text = clock(t); if (localDomCommit()) clockEl.textContent = text'],
          ["slider?.setAttribute('aria-valuenow', String(s))", "const now = String(s); if (localDomCommit()) slider?.setAttribute('aria-valuenow', now)"],
          ["slider?.setAttribute('aria-valuetext', clock(t))", "const label = clock(t); if (localDomCommit()) slider?.setAttribute('aria-valuetext', label)"],
          ["if (past !== m.past) m.el.classList.toggle('is-past', (m.past = past))", "if (past !== m.past) { m.past = past; if (localDomCommit()) m.el.classList.toggle('is-past', past) }"],
          ['const r = entry.contentRect', 'localCensus.resizes++; const r = entry.contentRect'],
          ['canvas.width = Math.round(r.width * dpr)', 'localCensus.backingChanges++; canvas.width = Math.round(r.width * dpr)'],
          ['    shown = t\n    timeline(t)', '    shown = t\n    localCensus.ticks++\n    timeline(t)'],
          ['    draw(t)\n    listeners.forEach', '    localCensus.draws++\n    draw(t)\n    listeners.forEach'],
        ]
        for (const [before, after] of edits) code = replaceOnce(code, before, after)
        changed.add('driver')
      } else if (id.endsWith('/features/home/useStory.ts')) {
        code = replaceOnce(code, "import { createDriver } from '../radar/driver'", "import { createDriver, localDomCommit } from '../radar/driver'")
        code = replaceOnce(code, "keys.forEach((el, i) => el.classList.toggle('is-lit', i === k))", "keys.forEach((el, i) => { const lit = i === k; if (localDomCommit()) el.classList.toggle('is-lit', lit) })")
        code = replaceOnce(code, "chapters.forEach((el, i) => el.classList.toggle('is-active', i === chapter))", "chapters.forEach((el, i) => { const active = i === chapter; if (localDomCommit()) el.classList.toggle('is-active', active) })")
        changed.add('story')
      }
      return code === source ? null : { code, map: null }
    },
    buildEnd(error) { if (!error) assert.deepEqual([...changed].sort(), ['driver', 'story']) },
  }
}
