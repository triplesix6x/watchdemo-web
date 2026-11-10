# Homepage graphics refactor evidence

## Scope

W7 moves four existing matrix and projection functions from `GhostFibers.tsx` to its private sibling `projection.ts`. Call sites, arithmetic order, ordinary `number[]` results, shaders, passes, uniforms, pointer handling, visibility behavior and disposal remain unchanged. This is an organization change, not an optimization.

The frozen source comparison and compiled old/new WebGL command oracle cover the complete component rather than a second implementation of its controller. The parent ran all eleven offline checks in `home-output-parity.test.mjs` and `home-output-comparison.test.mjs`. The existing frontend `npm run check` also passed. Two independent scoped reviews found no confirmed correctness, security or maintainability defects. Neither reviewer ran the tests.

## Actual GPU output

`home-output-pixels.json` records three independent hardware-GPU contexts: baseline, repeated baseline and candidate. Each context renders the real production homepage at 390 by 844 CSS pixels with DPR 1. Four fixed pointer and visibility states produce twelve nonempty RGBA captures.

The driver reads the GhostFibers default framebuffer immediately after its actual draw. Dimensions, frame metadata, DOM identity and exact RGBA hashes match for both the baseline repeat and candidate. No masks, blur, pixel tolerances or shader substitutions are used. The renderer is the host AMD Radeon RX 5700 XT through ANGLE D3D11. Browser, source, dependency and clock identities are recorded.

The report retains `accepting: false` and `EXACT_MATCH_REVIEW_REQUIRED`. The parent accepts this finite output comparison as evidence for the local extraction only. It does not establish every viewport, GPU, OS suspension transition or physical-phone result. Synchronous `readPixels` intentionally stalls the GPU, so these captures are not timing evidence.

Two checkout differences were only CRLF versus LF in valid UTF-8 source. The driver records raw hashes and `checkoutEolOnly`; it permits no other out-of-scope source difference.

## Whole-home timing

`home-output-profile.json` preserves the environment, sample order, CPU accounting and summary of fifteen whole-home samples. Ten unchanged baseline samples and five candidate samples alternate their positions. Each sample includes idle, scroll-down, offscreen idle and scroll reentry after normal lazy-image and font readiness.

The median frame interval is 6.9 ms for both groups, consistent with the host's approximately 144 Hz refresh limit. Median p95 is 7.85 ms for baseline and 8.0 ms for candidate; the baseline p95 range is 1.3 ms. This run does not demonstrate an improvement beyond repeat noise. No speedup or mobile smoothness claim follows from it. CDP main-thread task, script and layout durations are not whole-process or GPU time.

The full 2.8 MB timing diagnostic and raw RGBA buffers remain outside Git. The committed reports retain their identities and hashes; they are not visual goldens or automatic acceptance thresholds.

## Reproduction prerequisites

The CLI requires a clean, separately owned baseline checkout, the candidate checkout, existing frontend dependencies, an installed Edge executable and a new external output directory. It never installs dependencies. The parent runs one bounded Windows Job at a time with one logical CPU and at most 4096 MiB.

Offline checks require `QA_DEPS_ROOT` to be the absolute frontend dependency root:

```powershell
$env:QA_DEPS_ROOT = (Resolve-Path .).Path
node --test scripts/home-output-comparison.test.mjs scripts/home-output-parity.test.mjs
```

The GPU CLI accepts `--baseline-root`, `--candidate-root`, `--deps-root`, `--edge`, `--out` and `--dpr`. The timing CLI is separate so a fixed clock or framebuffer read cannot silently contaminate the benchmark. Both reject software rendering as performance evidence and retain strict owned-loopback network guards.

## Remaining limits

Physical iOS Safari and Android Chrome profiling remains the agreed post-deployment check. This task does not deploy or push. The retained graphics and CSS do not simplify the appearance to obtain a better score. Earlier software-renderer font stalls are not representative mobile measurements.

The optimization references in the specification describe compositor-friendly animation, rendering cost and power usage. They guide future measured candidates; they do not justify an unmeasured graphics reduction. Useful starting points are [high-performance animations](https://web.dev/articles/animations-guide) and [WebKit power usage](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/).
