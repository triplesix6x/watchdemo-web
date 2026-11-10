import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as oracle from './home-output-projection-oracle.mjs'

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const deps = process.env.QA_DEPS_ROOT
if (!deps || !path.isAbsolute(deps)) throw Error('Explicit absolute QA_DEPS_ROOT required; never install')
const require = createRequire(path.join(deps, 'package.json'))
const ts = require('typescript')
const sourcePath = 'frontend/src/features/backgrounds/GhostFibers/GhostFibers.tsx'
// Resolve once to an immutable object ID. The entire OLD component is transpiled
// independently, including its old private helpers (not linked to new helpers).
const baseline = execFileSync('git', ['-C', frontend, 'rev-parse', '0dc31b4^{commit}'], { encoding: 'utf8' }).trim()
const before = execFileSync('git', ['-C', frontend, 'show', `${baseline}:${sourcePath}`], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).replaceAll('\r\n', '\n')
const after = (await fs.readFile(path.join(frontend, '../', sourcePath), 'utf8')).replaceAll('\r\n', '\n')
const projectionSource = await fs.readFile(path.join(frontend, 'src/features/backgrounds/GhostFibers/projection.ts'), 'utf8')
function compile(source, imports = {}, globals = {}) {
  const exports = {}
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { exports, require(name) { if (!(name in imports)) throw Error(`Unexpected import ${name}`); return imports[name] }, ...globals })
  return exports
}
const production = compile(projectionSource)
test('GhostFibers organization changes only projection ownership, not shaders/passes/lifecycle', () => {
  const start = before.indexOf('const frustum =')
  const end = before.indexOf('const GhostFibers =', start)
  assert.ok(start > 0 && end > start)
  const frozenBody = before.slice(0, start) + before.slice(end)
  assert.equal(after.replace("import { frustum, multiply, orientation, applyMat3 } from './projection';\n", ''), frozenBody)
})
// Cross-realm arrays are normalized without converting IEEE values through JSON.
const values = array => Array.from(array)
test('projection: frozen arithmetic, seeded inputs, repeated/nonmonotonic calls, no input mutation or output aliasing', () => {
  let seed = 240621
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296 }
  for (let n = 0; n < 128; n++) {
    const angles = [random() * 12 - 6, random() * 12 - 6, random() * 12 - 6]
    const a = Array.from({ length: 16 }, () => random() * 20 - 10)
    const b = Array.from({ length: 16 }, () => random() * 20 - 10)
    const vector = [random(), random(), random()]
    for (const name of ['frustum', 'orientation', 'multiply', 'applyMat3']) {
      const args = name === 'frustum' ? [0.56, [390 / 844, 1280 / 900, 1][n % 3], 0.1, 60]
        : name === 'orientation' ? angles : name === 'multiply' ? [a, b] : [a, vector]
      const saved = args.map(v => Array.isArray(v) ? [...v] : v)
      const actual = production[name](...args)
      assert.deepEqual(values(actual), oracle[name](...args), `${name}/${n}`)
      assert.notEqual(actual, production[name](...args), 'each call still owns its output')
      assert.deepEqual(args, saved)
    }
  }
})

function renderer(source, props = {}, missing = false) {
  const commands = [], pending = new Map(), events = new Map(), cleanups = []
  let nextID = 0, refIndex = 0, objectID = 0
  const normalize = value => Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : value
  const gl = new Proxy({}, { get(target, key) {
    if (key in target) return target[key]
    if (String(key).toUpperCase() === key) return target[key] = String(key)
    return target[key] = (...args) => {
      commands.push([key, ...args.map(normalize)])
      if (key.startsWith('create')) return { id: ++objectID }
      if (key === 'getUniformLocation') return `${args[0].id}:${args[1]}`
      if (key === 'getShaderParameter' || key === 'getProgramParameter' || key === 'getExtension') return true
      return undefined
    }
  } })
  const addEventListener = (name, fn) => events.set(name, fn)
  const removeEventListener = name => events.delete(name)
  const rect = { left: 0, top: 0, width: 390, height: 844 }
  const container = { clientWidth: 390, clientHeight: 844, getBoundingClientRect: () => rect }
  const canvas = { width: 0, height: 0, getContext: () => missing ? null : gl }
  const document = { hidden: false, addEventListener, removeEventListener,
    documentElement: { addEventListener, removeEventListener },
    createElement: () => ({ getContext: () => ({ clearRect() {}, fillRect() {}, getImageData: () => ({ data: [140, 92, 245, 255] }) }) }) }
  const React = { useRef: value => ({ current: refIndex++ === 0 ? container : refIndex === 2 ? canvas : value }),
    useEffect: effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) } }
  class Observer { constructor(fn) { this.fn = fn } observe() {} disconnect() { commands.push(['disconnect']) } }
  const module = compile(source, { react: React, 'react/jsx-runtime': { jsx() {}, jsxs() {} }, './GhostFibers.css': {}, './projection': production,
    '../clock': { requestSharedFrame: fn => { pending.set(++nextID, fn); return nextID }, cancelSharedFrame: id => { pending.delete(id); commands.push(['cancel', id]) } } },
    { document, window: { devicePixelRatio: 2, matchMedia: () => ({ matches: false }), addEventListener, removeEventListener }, ResizeObserver: Observer, IntersectionObserver: Observer, Element: class {} })
  module.default(props)
  return { commands, frame(now) { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn(now)) },
    pointer(x, y) { events.get('pointermove')?.({ clientX: x, clientY: y }) },
    click() { events.get('pointerdown')?.({ clientX: 195, clientY: 422, button: 0 }) },
    visibility(hidden) { document.hidden = hidden; events.get('visibilitychange')?.() },
    destroy() { cleanups.forEach(fn => fn()) } }
}
for (const props of [{}, { paused: true }, { glow: 0, layers: 1 }, { perspective: 1, rotation: -35, layers: 3 }]) {
  test(`GhostFibers exact WebGL commands, pointer projections, first/nonmonotonic frames, hidden/dead lifecycle: ${JSON.stringify(props)}`, () => {
    const old = renderer(before, props), current = renderer(after, props)
    const same = label => assert.deepEqual(current.commands, old.commands, label)
    same('initial render')
    for (const time of [0, 16.667, 1000, 500, 501, 2000]) {
      old.pointer(121, 321); current.pointer(121, 321)
      old.frame(time); current.frame(time); same(`frame ${time}`)
      old.click(); current.click(); same('pulse hit test')
    }
    old.visibility(true); current.visibility(true)
    old.frame(3000); current.frame(3000); same('hidden')
    old.visibility(false); current.visibility(false)
    old.frame(4000); current.frame(4000); same('reentry')
    old.destroy(); current.destroy(); same('cleanup')
    old.frame(5000); current.frame(5000); same('dead')
    assert.ok(current.commands.some(c => c[0] === 'drawArrays'))
  })
}
test('GhostFibers missing WebGL context preserves empty output/lifecycle', () => {
  const old = renderer(before, {}, true), current = renderer(after, {}, true)
  old.frame(0); current.frame(0); old.destroy(); current.destroy()
  assert.deepEqual(current.commands, old.commands)
  assert.equal(current.commands.length, 0)
})
