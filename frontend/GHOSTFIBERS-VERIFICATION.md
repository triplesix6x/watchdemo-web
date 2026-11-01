# Selected homepage design

This branch adds GhostFibers, the matte-glass replay window, and the moving text gradient to the original homepage. It does not include the superseded Focus redesign, background selectors, window selectors, freeze controls, or other background renderers.

## Selected settings

- GhostFibers: blue `#5b97f0`, line `#7eb1f7`, secondary `#2f6fd2`, speed `0.22`, brightness `1.1`, glow `0.65`, DPR `1`, opacity `0.6`. Pointer interaction and click pulses remain enabled.
- Matte glass: `rgb(13 15 19 / .28)`, `12px` backdrop blur, `115%` saturation, and a fine blue outline. The canvas and sticky stage are not transformed.
- Hero accent: “прямо в игре.” and “right in the game.” use the existing blue and ink-50 tokens. The 115-degree gradient moves continuously left to right. A complete repeated tile moves in 6s at constant speed, with matching blue edges at the loop boundary.

The full original lead sentence remains the localization source. `hero.check.ts` verifies that each highlighted phrase is its exact suffix.

## Preserved scope

The branch starts at `f4a0e1d`. It preserves the original layout, Onest fonts, global palette, copy, screenshots, demo data, map colors, timeline, and other routes. No dependency or lockfile changes are required. Desktop application files and the original dirty working directory are untouched.

The renderer loads lazily after hydration. It unmounts outside the hero viewport and cleans up on navigation. The vendor's frame scheduling uses the existing GSAP ticker. React StrictMode cleanup releases GPU resources without losing the React-owned canvas context.

Reduced motion disables the moving background and keeps a static text gradient. Reduced transparency and increased contrast disable the background and use an opaque replay surface. Unsupported WebGL2 leaves the original content and the separate 2D radar usable.

## Verification results

- `npm run check`: nine checks pass.
- `npm run build`: TypeScript, client build, SSR build, and prerender pass.
- `npm run build:mock`: passes.
- `node scripts/ghostfibers-home-qa.mjs`: five cases pass. Four cover Russian and English at 375px and 1280px. The fifth simulates unavailable WebGL2.
- Browser assertions cover the selected material, square radar buffers, valid WebGL context, the exact original text, gradient direction and timing, no page overflow, keyboard timeline seeking, offscreen unmount and remount, client-route navigation, reduced motion, reduced transparency, forced colors, and no console or page errors.
- Russian screenshots at both widths were visually reviewed. Captures and the JSON report are written to `/tmp/watchdemo-ghostfibers-home/` by the QA script. These screenshots do not establish hardware frame rate or every animated frame's contrast.

The browser QA uses a mock build and `QA_ORIGIN` (default `http://127.0.0.1:4540`). With Vite preview, the English artifact is available at `/en/`. Vite preview incorrectly serves Russian fallback HTML at `/en` without the trailing slash. Production nginx already resolves `$uri/index.html` for `/en`, and its configuration is unchanged. The blocked change to the helper QA server was not applied.

`npm ci` reports 11 advisories from the unchanged lockfile (one low, five moderate, five high). This design branch does not apply dependency upgrades.

## Third-party license

GhostFibers is adapted from [React Bits](https://github.com/DavidHDev/react-bits). The full MIT plus Commons Clause terms ship in `public/licenses/react-bits.txt`. The branch embeds the effect in the website; it does not distribute a standalone component product.
