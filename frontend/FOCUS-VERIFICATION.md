# Focus implementation and verification

## Delivered

The approved Focus prototype is integrated into the existing React/Vite website. The existing Svelte/Tauri desktop application received styling-only synchronization.

- The new home hero retains the approved Onest typography, blue primary action, interactive terrain, temporary orange click crest, screenshot contour and broad warm grounding beneath the product image. It uses the existing public navigation.
- CS2 has a separate, clearly labeled screenshot-based explanation. No video, game launch or automatic same-tick synchronization is simulated.
- The original 75-second Falcons–Spirit Mirage round is a separate, bounded scroll episode. The timeline supports exact start/end and reverse keyboard seeking. The large mobile radar leaves with its episode.
- The library, moments, sets, replay, notes, grouping, statistics and download/pricing paths remain represented. Shared public, authentication, account and admin surfaces use the new palette.
- The existing six `public/screens/` files and `src/assets/demo/` data are unchanged. New hero images are derived color studies, not captures of an updated native build. Their provenance is documented in `public/focus/README.md`.
- Desktop layout, handlers, translations, data, semantic/team colors and native logic remain unchanged. Its changed paths are `tailwind.config.js`, `src/app.css`, `src/LoginApp.svelte`, `src/UpdaterApp.svelte`, and styling classes in RoundStrip, MultiSelect and DemoGroupsItems.

## Completed checks

| Check | Evidence |
| --- | --- |
| Website source checks | `npm run check`: 9 check files pass, including episode-offset/reverse seeking and palette/contrast checks. |
| Production build | `npm run build`: TypeScript, client, SSR and 12 localized prerendered pages pass. |
| Mock production build | `npm run build:mock`: same build stages pass; used for local browser verification without a production API proxy. |
| Website route/browser matrix | `focus-site-qa.mjs`: 59 cases pass on both Vite and the served mock production build. Production run also asserts real HTTP 404 statuses for missing RU/EN routes. Covers errors, axe WCAG A/AA findings, images, page overflow, anonymous auth forms, mobile menu keyboard operation and focus restoration. |
| Actual hero rendering | `focus-hero-qa.mjs`: 11 cases pass on the served build. Covers RU/EN at 375, 390, 820, 1280 and 1440 px; actual Onest glyph use via CDP; GPU input uniforms; pause, preferences, context remount, offscreen suspension and no-WebGL fallback. |
| Episode/support interaction | `focus-interaction-qa.mjs`: 7 cases pass. Covers exact 0/75-second endpoints, reverse seeking, route remount, bounded mobile stage, square radar buffers, and selected support threads at 375/820/1280 px. |
| Orange accent | `focus-accent-qa.mjs`: isolated real shader screenshots show 0 warm pixels idle, 2717 during the sampled crest, then 0 after settling. This is an image-regression observation, not a performance measurement. |
| Visual review | A fresh screenshot-only reviewer inspected 12 desktop/tablet/mobile states and found no visible defects in those supplied states. No site score or complete accessibility certification is claimed. |
| Desktop source/build | Worker reports `npm run check` with 0 Svelte errors/warnings and 657 RU/EN keys; `npm run build` passes. An independent source reviewer found no concrete issue in the styling-only diff. Existing build warnings remain. |

An independent website source reviewer found a support-log layout regression after the accessibility wrapper was added. The wrapper's growth selector now targets `.sp-thread-body > .sp-log-region`. The reproduced composer footer gap changed from 158.48 px to the intended 16 px; all three support widths now assert this behavior. Ordered-list semantics and the outer live-log region are preserved.

The story worker timed out after writing its seven files and final report. Its artifacts were inspected, integrated, independently reviewed, built and browser-tested; its process is not recorded as a successful exit. The shared-system and desktop workers completed normally.

## Reproduce local website verification

Use existing dependencies in `frontend/`. Browser scripts require local Chrome at `/opt/google/chrome/chrome`; the accent check also requires Python Pillow. Chromium sandboxing stays enabled.

```sh
npm run check
npm run build
npm run build:mock
node scripts/serve.mjs 4520
```

In another terminal, from `frontend/`:

```sh
FOCUS_SITE_URL=http://127.0.0.1:4520 FOCUS_REQUIRE_404=1 node scripts/focus-site-qa.mjs
FOCUS_URL=http://127.0.0.1:4520/ node scripts/focus-hero-qa.mjs
node scripts/focus-interaction-qa.mjs
node scripts/focus-accent-qa.mjs
node scripts/focus-visual-qa.mjs
```

The static QA server now binds only to `127.0.0.1`. It serves prerendered public pages, SPA account/admin routes and localized 404 pages without an API proxy. Build mock output before using it for browser checks. `scripts/focus-preview.html` and its TSX entry are a Vite-only component harness, not production build entries.

Reports and screenshots are written under `/tmp/watchdemo-focus-*`. The final route report is `/tmp/watchdemo-focus-site-production/report.json`; hero, interaction, accent and visual artifacts use their correspondingly named directories. Source reviewer and visual reviewer reports are retained in the Pi subagent artifacts.

## Remaining limits

1. **Real CS2 recording is pending.** The owner will supply the agreed recording of the actual WatchDemo-to-CS2 flow. The current screenshot explanation must not be presented as proof of game launch, loading time or same-tick playback.
2. **Desktop browser acceptance is partial.** Initial sandboxed DEV showcase captures and computed-style checks completed. The corrected rerun of `node /tmp/watchdemo-focus-qa.mjs` was blocked before execution because the permission classifier timed out after 20000 ms. It was not retried or replaced with an equivalent workaround. Login/updater states, settled menus/modals and comprehensive browser accessibility/overflow acceptance remain unverified.
3. **Native Windows/Steam/CS2 behavior was not run.** No game or native app was started, and no Rust, game configuration, credentials or deployment state was changed.
4. **Existing route-transition behavior is unchanged.** The public-page curtain consumes rapid repeat navigation until its entrance settles. The interaction harness waits for the actual curtain to become hidden before returning home; it does not claim interruptible route transitions.
5. Automated checks and emulated viewport screenshots do not replace real-device or assistive-technology testing. No throughput, latency, FPS or Awwwards score is claimed.

No commits or deployment were made. Unrelated user files, existing migrations and desktop `ARCHITECTURE.md` remain untouched. Rejected-iteration worktrees and their rollback backup were not reused or removed.
