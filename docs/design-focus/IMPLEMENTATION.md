# Focus: production implementation

The user approved the current interactive prototype on 2026-10-31. This plan supersedes the rejected first redesign. The visual reference is `Focus.tsx` plus `focus.css` in this directory, including the scene-level warm light below the product, a matching faint reflection on its surface, and the transient orange crest in Topography.

## Invariants

- Keep Onest, real Falcons–Spirit match data, original screenshots, team/status semantics, routes, pricing, authentication, account and admin behavior.
- Blue #0297DE is the primary action color; orange #FC734D belongs to lighting, fine details and the click wave, not large tool strips or highlighted prose.
- Ground #02070A, surface #0B1821, text #EDF5FA, muted #A2B3BF. Dark labels on bright blue; white labels require a darker blue with measured contrast.
- No fabricated game scene, launch timing, testimonial or match. Real WatchDemo → CS2 video remains pending; provide a useful screenshot-based explanation until supplied, not a fake player or a public production placeholder.
- Desktop layout and workflows remain intact. No Rust/game/Steam changes, native launch, deployment, commits, permission configuration changes or unrelated file changes.

## Composition and ownership

1. **Parent: hero and terrain.** `frontend/src/features/focus/**`, associated new assets and integration QA. `FocusHero({version?: string})` is self-contained, localized, SSR-safe. Home mounts it outside the replay story. Reuse approved terrain code and license, lazy-load it after hydration, use the existing GSAP clock, retain visibility/context/resource cleanup and accessibility fallbacks. Scene light follows the product through ResizeObserver, with a stable CSS fallback. No prototype toolbar in production. Real download route and an anchor to the next section replace prototype links.
2. **Story worker: homepage below hero.** Own `frontend/src/pages/Home.tsx`, `frontend/src/features/home/**`, `frontend/src/features/radar/**`, home RU/EN dictionaries only. Import `FocusHero` from `../features/focus/FocusHero` and mount `<FocusHero version={version} />`. Parent supplies it during integration; no placeholder module. Keep Head/release metadata. Separate CS2 explanation from a large original 2D episode, then full library/moments/sets/notes overview and conversion. Reuse real data and current radar engine; no continuous phone-wide sticky strip outside the episode. Preserve keyboard/pointer seek and reduced motion. Avoid synthetic content and unsupported native launch promises.
3. **System worker: shared site.** Own shared styles, UI/layouts and non-home page CSS, including admin styling. Do not edit Home, home/radar/focus, engine or business logic. Harmonize all existing public/account/admin/auth pages with the selected product direction; avoid new decorative boxes. Preserve flow and accessible focus/contrast.
4. **Desktop worker: desktop repo only.** Synchronize palette/materials/button details without restructuring. Use existing DEV showcase/browser capabilities to inspect real components; native behavior is not validated by a browser. If main preview cannot safely reuse actual data, do not invent replacement match fixtures or regenerate website screenshots. Report limits rather than silently adding a fake main app. No changes to user-owned ARCHITECTURE.md.

Use separate worktrees for website writers, a sole writer in the desktop repo, and no commits. Parent merges only owned paths and reviews actual diffs. Preserve all pre-existing untracked files in both repos. The old `/tmp/watchdemo-site-*` worktrees contain rejected changes and must not be reused.

## Verification and delivery gates

Run website checks, TypeScript/client/SSR/prerender build and desktop check/build. Drive mock local routes (never production APIs) at 375/390/820/1280/1440, RU/EN, keyboard/focus/menus/slider, reduced motion/transparency/contrast and no WebGL. Inspect screenshots, not only automated scores. Test active terrain hover/pulse, teardown/remount/context health, offscreen sleep and orange crest returning to blue. Check original radar round/square canvas on resize and its own story bounds. Verify download links, real image content and desktop primary contrast. Obtain an independent review, fix demonstrated findings and report remaining Windows-only/native/video limits. Do not describe unrecorded CS2 launch as runtime-verified.
