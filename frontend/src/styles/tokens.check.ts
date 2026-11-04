// node src/styles/tokens.check.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
const tokens = new Map([...css.matchAll(/(--[\w-]+):\s*(#[\da-f]{6});/gi)].map((m) => [m[1], m[2].toUpperCase()]))
const color = (name: string): string => {
  const value = tokens.get(name)
  assert.ok(value, `missing literal colour token ${name}`)
  return value
}
const luminance = (hex: string): number => {
  const channels = hex.slice(1).match(/../g)!.map((channel) => {
    const value = parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
const contrast = (a: string, b: string): number => {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
for (const [name, expected] of Object.entries({
  '--ink-950': '#02070A', '--ink-800': '#0B1821', '--ink-50': '#EDF5FA',
  '--ink-300': '#A2B3BF', '--brand-500': '#0297DE', '--c-warm': '#FC734D',
  '--side-t': '#E0B96B', '--side-ct': '#7EB6E8',
  '--success': '#34D399', '--warning': '#FBBF24', '--danger': '#FB7185',
})) assert.equal(color(name), expected, name)
for (const surface of ['--ink-950', '--ink-900', '--ink-800']) {
  for (const text of ['--ink-50', '--ink-100', '--ink-200', '--ink-300', '--brand-400']) {
    assert.ok(contrast(color(text), color(surface)) >= 4.5, `${text} must be AA on ${surface}`)
  }
}
for (const [text, background] of [
  [color('--ink-950'), color('--brand-500')],
  [color('--ink-950'), color('--brand-400')],
  [color('--ink-950'), color('--danger-strong')],
  ['#FFFFFF', color('--brand-600')],
]) {
  const ratio = contrast(text, background)
  assert.ok(ratio >= 4.5, `${text} on ${background}: ${ratio.toFixed(2)}:1 must be AA`)
  console.log(`tokens contrast: ${text} on ${background} = ${ratio.toFixed(2)}:1`)
}
console.log('tokens: Focus palette, semantic colours and text/action contrast ok')
