# Homepage scroll attribution (non-accepting)

`home-scroll-diagnostic.mjs` builds isolated complete homepage graphs outside every repository. It does not edit source, add a public debug query, or relax `home-output-comparison`'s hardware gate. Suppressions are test-build transforms with exact single-match anchors. They are not shipping optimizations.

## Parent execution only

Run serially inside the coordinator's existing CPU/RAM/PID limits, with available memory checked first. Do not run alongside builds, tests, another browser, or infrastructure startup. Suggested initial envelope: 2 CPUs, 3 GiB memory, 256 PIDs, external `timeout 600s`; adjust only after observing actual needs. The runner owns a single browser, one context at a time and exact loopback port 55450. It inherits DISPLAY for `--headful`. Builds have 90-second bounds, page operations 20 seconds, launch 30 seconds; external timeout remains the hard process/resource backstop. Output parent directory must exist, output directory itself must not exist.

```sh
node frontend/scripts/home-scroll-diagnostic.mjs \
  --baseline-root /home/bigboss/.local/share/watchdemo-site-fixes-20261112/baseline \
  --candidate-root /home/bigboss/.local/share/watchdemo-site-fixes-20261112/performance \
  --deps-root /home/bigboss/PycharmProjects/watchdemo-web/frontend \
  --chromium /home/bigboss/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
  --output /home/bigboss/.local/share/watchdemo-scroll-diag-01 \
  --headful --width 390 --height 844 --dpr 1 --input wheel --repeats 3
```

First smoke: `--variants normal,background-off --repeats 1`. A single repeat is not evidence of improvement. Full default selection includes normal, background off, background frozen, blur off, background hover off, radar draw off. All diagnostic variants use baseline, one factor at a time; candidate always runs unsuppressed. Each repeat includes an additional baseline A1 control, rotating order across repeats. To compare an implemented optimization with baseline only use `--variants normal --repeats 3` (two baseline contexts plus candidate per repeat).

Repeat separately with `--input touch` (CDP touch sequences), then desktop e.g. `--width 1280 --height 900 --input wheel`. Do not combine differently sized runs into one speedup claim. Phone viewport emulation is not an iPhone GPU or Safari test.

Parent lightweight checks (not run by worker):

```sh
node --check frontend/scripts/home-scroll-diagnostic.mjs
node --test frontend/scripts/home-scroll-diagnostic.test.mjs
```

## Recorded contract

- Complete baseline/candidate frontend source hashes, HEAD/status, lockfile identity, browser executable hash/version, OS, flags, viewport/DPR/visual viewport scale, actual WebGL vendor/renderer/version/software classification.
- Cold navigation to canvas/font readiness is separate from warm phases. Mock anonymous API mode prevents contacting a backend or production. Real page font/image decode and normal-scroll image preconditioning precede warm measurement. Preconditioning uses scrollTo; the measured input workload never does.
- Warm idle, real-input downward scrolling, offscreen idle, upward scrolling and hero reentry; each retains frame intervals, p50/p95/p99/worst/tail counts, longtasks/LoAF, scroll position, stage visibility and canvas buffers. CDP main-thread CPU task/script/style/layout deltas are per phase. Screenshots occur outside timed phases.
- Geometry must match exactly across all source/variant samples; this intentionally rejects a candidate containing responsive-layout changes. Run the isolated performance worktree before integrating public-lane geometry changes.
- Frozen uses the renderer's existing `paused` prop (pointer settling may briefly draw); hover-off disables pointer interaction, including click pulse, only in diagnostic builds. Radar-off suppresses only `draw(t)`; clock/timeline/listener updates remain.
- Offscreen and hero-return assertions reject incomplete gestures instead of reporting misleading timings. At desktop widths (>=900px), if the real-input traversal reaches the document boundary but sticky geometry still exposes the map, `offscreenEvidence` is `unavailable-at-document-end`, not a claimed offscreen pass. Mobile retains the strict offscreen assertion. Product geometry is never modified to manufacture an offscreen result. Runtime/network failures are retained in a ledger and invalidate completion. Original source identities are checked again at completion.

## Interpretation and limitations

The JSON is always `accepting:false`. Inspect phase distributions across repeats and A/A variability; do not infer a speedup from one p95 or an average FPS. rAF intervals measure scheduling, not presented GPU frames. CDP CPU is not GPU time or process CPU. No refresh-rate or power/thermal stability guarantee is made. Cold instrumentation begins before navigation but does not include browser startup; it ends at canvas attachment/fonts readiness, not guaranteed shader completion. Screenshot capture can perturb subsequent phases despite being excluded from timing; use repeated controls.

Headful hardware was reported by the coordinator on this host; each run records its own renderer rather than assuming it. Software rendering is allowed only for diagnostic information and is explicitly marked. This harness alone does not prove functional/visual parity, smooth player interpolation, hidden-tab lifecycle or physical-phone performance. Existing functional QA and direct visual review remain required after a measured candidate is selected.

## Selected candidate and observed evidence

Coordinator-run hardware attribution at `/home/bigboss/.local/share/watchdemo-scroll-diag-attribution-mobile-01/home-scroll-diagnostic.json` completed 24 samples (three repeats), 390×844 DPR1, CDP touch, Intel ANGLE/Mesa, with an empty runtime/network ledger. Baseline normal idle script times were 114.3/107.1/111.2ms per 2s; background-off was 42.8/41.2/43.1ms. Reentry normal was 78.6/79.4/65.8ms versus 35.7/36.1/37.7ms. Frame p95 stayed approximately 8.4ms; severe reported user lag was not reproduced. Radar-off did not show a total-CPU win. Blur attribution overlapped A/A noise, so neither radar nor glass is changed.

The candidate gates only GhostFibers simulation/render submissions to approximately 60Hz on high-refresh displays. It retains the GSAP clock and elapsed time between accepted frames, so the ambient motion speed does not depend on submitted frame count. There is no extra timer, new WebGL context or resource allocation. Immediate resize rendering, pointer wake, existing reduced-motion/transparency logic, hidden/offscreen gating and cleanup remain. The radar/story clock, smooth players, trails, map, timeline, events and seek are untouched. The helper resets its deadline on wake and does not issue catch-up renders after interruption. Shaders, scene density, colors, glow, glass and geometry are unchanged.

This targets a repeatedly measured background CPU contributor; no candidate timing or speedup has yet been measured. At a native 60Hz refresh it is intentionally near a no-op, and it does not establish a fix for phone Safari or the original lag complaint. A paused-background diagnostic still permits pointer-settling work; it must not be interpreted as a strict zero-render variant.

Additional focused parent check:

```sh
node --no-warnings frontend/src/features/backgrounds/GhostFibers/cadence.check.ts
```

Then repeat the same mobile workload with `--variants normal --repeats 3` and a fresh output path, followed by desktop wheel and functional/visual lifecycle QA. Keep responsive-layout changes out of the comparison until performance evidence has been collected.
