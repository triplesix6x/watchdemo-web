import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./home.css', import.meta.url), 'utf8')
const mobileStage = css.match(/@media \(max-width: 899px\)\s*\{[\s\S]*?\.story-stage\.island\s*\{([^}]+)\}/)?.[1]
assert.ok(mobileStage, 'The mobile story stage must have its own layout rule')

// Source wiring only; browser checks must also measure the frame and page overflow.
// A fixed 100% width plus negative margins left a two-page-pad gap on the right.
assert.match(mobileStage, /\bwidth:\s*auto\s*;/, 'The mobile stage must stretch across both negative margins')
assert.match(mobileStage, /\bmargin-inline:\s*calc\(-1 \* var\(--page-pad\)\)\s*;/, 'Keep the intentional full-bleed mobile housing')
assert.match(mobileStage, /\bpadding:\s*0\.625rem var\(--page-pad\) 0\s*;/, 'Keep equal radar insets inside the mobile housing')
console.log('home layout: mobile full-bleed stage sizing source wiring ok')
