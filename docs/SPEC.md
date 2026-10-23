# watchdemo.pro redesign: spec

Branch: `redesign/site` (local only). Status: approved through the interview on 2026-10-23.
The desktop app (`D:\demo-manager`, branch `redesign/ux`) is the style source. Its redesign spec is `D:\demo-manager\docs\redesign\SPEC.md`.

## 0. Decisions from the interview

| Topic | Decision |
|---|---|
| Scope | Frontend plus a large backend: new endpoints, migrations and emails. |
| Stack | Keep Vite + React 18 + react-router 6, Docker + nginx static. Public pages are prerendered to HTML at build time; the cabinet and admin stay SPA. GSAP + Lenis for motion. |
| Language | Russian (default, `/`) and English (`/en/...`), with `hreflang` and a language switch. All strings live in dictionaries. The user's locale is stored server-side and used for emails. |
| Pricing | Basic / Plus / Pro comparison with no payment. Prices are config fields marked `placeholder`. The "Получить доступ" button links to https://t.me/zeroikins. |
| Telegram | Project channel https://t.me/watchdemopro goes in the footer, on «Что нового» and on «Помощь». |
| Concept | "The site plays like a replay" (section 2). |
| Imagery | Real app screenshots in `frontend/public/screens/`, taken from the redesigned app at 1280×800 with real data (Falcons vs Spirit demos). Plus a live radar fed by real round data. No div-built fake screenshots. |
| Legal pages | None for now: no terms or privacy pages and no links to them. |
| Emails | Redesigned RU/EN templates in the app style, with a logo, a text part and one brand button colour. |

## 1. Information architecture

Old URLs must keep working, because the desktop app and the emails open them: `/register`, `/forgot-password`, `/dashboard` (now redirects to `/account`), `/verify-email`, `/reset-password`, and `/releases/*` and `/api/*` (served by nginx).

```
PUBLIC (prerendered, RU at /, EN at /en/)
/             home: concept, product story, CTA download
/download     installer, version, size, SHA-256, requirements, install steps, SmartScreen note
/pricing      Basic / Plus / Pro matrix from GET /app/tiers, "Получить доступ" -> Telegram
/changelog    public release notes from GET /app/releases, link to the channel
/help         FAQ, install, first run, CS2 hotkeys (F5-F9), troubleshooting, contacts
404           designed, real 404 status from nginx for unknown prerendered paths

ACCOUNT (SPA)
/login /register /forgot-password /reset-password /verify-email /resend-verification
/confirm-email-change?token=

CABINET (SPA, auth)
/account            overview: tier, expiry, features and limits, download for my channel,
                    beta status, "Получить доступ"
/account/security   change password (option: sign out other devices), devices list
                    with readable names, sign out one / all others
/account/profile    username, email change (confirm via new address), member since,
                    language, delete account

ADMIN (SPA, roles support+; tabs in URL)
/admin              overview: stat tiles, signups chart 30/90 d, tier split, expiring in 7 d
/admin/users        filters, search, table; /admin/users/:id detail with actions
/admin/releases     list, publish (upload), edit notes, show-in-changelog, active toggle
/admin/audit        audit log (admin)
```

Each screen has one primary action, following the app's Hick's-law rules:
- Home: «Скачать для Windows».
- Download: the download button.
- Pricing: «Получить доступ» on the recommended tier only.
- Cabinet overview: download, or «Получить доступ» when the user has no tier.
- Security: «Сменить пароль».
- Admin users: none; actions live in the detail page and its menu.
- Admin releases: «Опубликовать».

## 2. Concept card (home and brand surfaces)

```
Idea:        The site plays like a replay: scrolling scrubs a real CS2 round on a live 2D radar, and every event in that round opens the part of the product it explains.
Metaphor:    the app's own 2D replay: radar, round timeline, kill feed, bomb plant and defuse markers.
Signature:   the pinned radar on the home page. Round 13 of Falcons vs Spirit (de_mirage) is scrubbed by scroll progress through one driver module. The bottom timeline shows real event markers (kills, plant at 0:30, defuse at 1:10). Each chapter of copy is anchored to one event.
Emotion:     the first three seconds feel like opening a demo: calm, precise, already in motion.
Motion verb: scrub and settle. Things move like a timeline being scrubbed (1:1 with input), then settle on the app's critically damped spring.
Screenshot:  the radar mid-retake, ten dots with movement trails, the timeline under it with the plant marker lit, and the headline beside it.
```

Data: `frontend/src/assets/demo/mirage-r13.json` is real round data, sampled at 8 Hz, with positions normalised to the 1024-px radar `mirage-radar.png`.
- **Fields:**
  - `players[i].side`
  - `frames: [t, [[i, x, y, alive, yaw], ...]]`, where `t` is ticks after freeze end at 64 tick
  - `kills` (`t`, `killer`, `victim`, `weapon`, `hs`)
  - `plant` (`t`, `xy`)
  - `end` (defused)
  - `winner`
- **Player names are removed on purpose.** Players are labelled by side (CT 1-5, T 1-5).
- **Idle state:** at rest, the radar keeps playing a slow 0.25x loop of the ±2 s around the current scroll position. It runs on the GSAP ticker, pauses off screen and is off under reduced motion.

Chapters (home), each tied to one event of the round. Copy comes from the real product.

| Event | Chapter | Shows |
|---|---|---|
| freeze end | Hero: the library and the main promise, «Смотреть в CS2» in one click | `app-home.png` |
| first kill | Moments: auto sets (kills, deaths, openings, clutches...) | `app-moments.png` |
| plant | Your own sets: mark moments in 2D, play the whole set in CS2 with F8/F7 | `app-set-panel.png` + a hotkey strip |
| retake kills | 2D replay with voice, drawing tools, player panel | `app-replay-live.png` |
| defuse | Notes, groups, search; then download CTA | `app-info.png` |

Mobile (390 px): the radar is a compact sticky band at the top (about 42vh). The chapters scroll under it, and the timeline becomes a progress rail. The radar is never removed; under reduced motion it shows a static frame at each chapter's event.

**Loader:** none. The **hero intro** is the logo intro from the app: the corners fly in and the cross turns. The radar resolves from the logo's cross position.

**Page transition (public pages):** the logo corners converge to cover the viewport edges and spread open on the new page. This uses the app's loader shapes and is at most 600 ms. Under reduced motion it is a 150 ms cross-fade.

**404:** the radar of an empty round. The timeline is at 0:00 with nothing on it. Copy: «Этой страницы нет в демке.», with a link home.

## 3. Art direction (from the app)

- **Palette:** take the app's tokens verbatim (`D:\demo-manager\tailwind.config.js` and `src/app.css`).
  - Ground: `ink-950` `#0d0f13`, frame `ink-800`.
  - Islands: gradient `ink-900`→`ink-950`.
  - Text: `ink-50`/`ink-100`; muted `ink-300`/`ink-400`; lines `white/6%`.
  - Accent: `brand-500` `#5b97f0`, with primary buttons on `brand-600` `#2f6fd2`. Brand colour is used only for primary actions and selection.
  - Sides: T `#e0b96b`, CT `#7eb6e8` (radar dots, timeline markers).
  - Status: emerald for success, amber for warnings, rose for danger.
  - The site is dark only.
- **Type:** Onest, self-hosted via `@fontsource/onest` (the CSP allows only self), weights 400/500/600/700.
  - Display on the home page: fluid `clamp(2.75rem, 6vw, 5.5rem)`, tracking -0.03em, leading 1.0.
  - Headings: -0.02em.
  - Body: 16-17 px / 1.55.
  - `font-variant-numeric: tabular-nums` for times, versions and sizes.
- **Shape:** the app's radius tokens (`--r-*`) and `corner-shape: squircle` under `@supports`. Circles stay round.
- **Grid:** 12 columns, 24 px gutter, max 1240 px, left-aligned.
  - Home is split: radar stage plus a chapter column.
  - Other public pages use a 7/5 or 8/4 split; the cabinet and admin use the app shell (sidebar island + content island).
- **Motion:**
  - The app's spring tokens (`--ease-spring*`, `--dur-*`) and the `linear()` curves.
  - Press is scale 0.97 on pointer-down.
  - Rubber-band at the edges where there is a drag.
  - One clock (the GSAP ticker).
  - Every primary target answers in the verb: buttons press and settle; nav links get an underline that scrubs in from the left like the timeline thumb.
  - Reduced motion: no scrub, no Lenis, opacity only.
- **Components:** port the app's design system to React with the same class names and look:
  - `btn-primary`/`btn-soft`/`btn-ghost`/`btn-danger`/`btn-icon`
  - `island`, `card`, `seg`, `input`, `list-row`
  - Menu, ConfirmModal, InlineRename
  - `Logo`/`LogoLoader`/`MiniLoader`, with the exact keyframes, including the anti-snap 0.02deg rotation and literal easings inside keyframes
- **Loaders:** none under 100 ms, `MiniLoader` up to 1 s, skeletons beyond, as in the app.
- **Genericness check:**
  - No gradient blob hero, no three equal feature cards, no eyebrow labels, no em dashes in copy, no "→" in labels.
  - Pricing is a comparison table with one highlighted column, not three floating cards.

## 4. Backend additions (FastAPI, `web/`)

Every new endpoint needs validation at the boundary, audit logging for admin actions, and the error shape `{message}`. Migrations go through Alembic.

**Public**
- `GET /app/latest?target=windows&arch=x86_64`. Auth is optional; beta testers get the beta channel. Returns `{version, channel, url, file_name, file_size, sha256, published_at, notes}`; 404 if none.
- `GET /app/releases?channel=stable&limit=20`. Returns active releases with `show_in_changelog`, newest first: `{version, channel, published_at, notes}`.
- `GET /app/tiers`. The feature/limit matrix, mirroring the desktop `core/access.rs`:
  - Basic: DemoImport 10/mo, ContentSearch.
  - Plus: 100/mo, Replay2d.
  - Pro: unlimited, AdvancedStats.

  Mark it in code as "keep in sync with the app".

**User (`/users/me`)**
- `GET /me` adds `created_at`, `is_beta_tester`, `locale`, `subscription.started_at`.
- `PATCH /me {username?, locale?}`. Username keeps the register rules and is unique (409).
- `POST /me/password {current_password, new_password, sign_out_others: bool}`. Sends a "password changed" email.
- `POST /me/email {new_email, password}`. Sends a confirm link to the new address and a notice to the old one; one-time token type `email_change` with a 24 h TTL. `GET /auth/confirm-email-change?token=` applies it.
- `DELETE /me {password, username}` (the username must match). Anonymises email/username, sets `is_active=false`, revokes all sessions and deletes one-time tokens. Audit rows stay.
- `POST /auth/register` accepts an optional `locale` (ru|en).

**Security fix:** `get_current_auth` must reject an access token whose session (`sid`) is revoked or inactive. Cache the check in Redis for 60 s, and invalidate it on revoke so a revoke takes effect at once.

**Admin**
- `GET /admin/stats/timeseries?days=30|90` returns `{signups: [{date, count}], tiers: {...}, expiring_soon: [{user_id, username, tier, expires_at}]}`.
- `POST /admin/subscriptions/extend {user_id, days}` and `POST /admin/subscriptions/revoke {user_id}` (moderator+).
- `DELETE /admin/users/{id}/sessions`, `POST /admin/users/{id}/password-reset` (sends the email), `POST /admin/users/{id}/verify` (moderator+).
- `PATCH /admin/releases/{id} {notes?, show_in_changelog?}` (admin).
- New audit actions for every one of these.

**Migrations**
- `users.locale` (varchar 5, default 'ru').
- `releases.show_in_changelog` (bool, default true).
- The token type enum gains `email_change`, with a `payload` column for the new email.
- Migration 0002 builds on the production head `03b05dc2017c` (the server's autogenerated chain `907b2d179318` → `2719b4ef61f3` → `03b05dc2017c`, now tracked in the repo). Do not commit `__pycache__`.

**Emails (`mail/`)**
- RU/EN templates for: verify, reset, welcome, email-change confirm, email-change notice, password changed.
- Table layout with inline styles, a dark app style, the logo as a hosted PNG (`https://watchdemo.pro/brand/logo-64.png`), and a plain-text part.
- The language comes from `users.locale`.

**Desktop app note (not in this branch):** the app should send `User-Agent: WatchDemo/<version> (Windows)` so the devices list can name it. Until then, the frontend parser treats a missing or non-browser UA as «Приложение WatchDemo».

## 5. Frontend infrastructure

- **API client:** handle `{message}`, FastAPI `{detail: [...]}` (422) and `{detail}` (429) with human RU/EN text. Keep the in-memory access token and cookie refresh.
- **Mock API mode** (`VITE_MOCK_API=1`, dev and QA only, tree-shaken from prod): realistic fixtures for every endpoint, so the cabinet and admin can be screenshotted without a backend. It is never enabled in production builds.
- **Prerender:** a build step renders the public routes for both locales with `react-dom/server` and `StaticRouter`. Each page gets its own title, description, canonical, hreflang, OG and Twitter tags and JSON-LD (`SoftwareApplication` on home and download). Output goes to `dist/<path>/index.html`; the client hydrates. Also generate `sitemap.xml` and `robots.txt`, with the OG image built from the hero frame.
- **nginx:**
  - `try_files $uri $uri/index.html /index.html` for SPA routes.
  - A real 404 for unknown public paths.
  - gzip on.
  - Long cache for `/assets/*` (hashed), no-cache for HTML.
  - Re-add the security headers in the `/releases/` location.
  - The CSP stays self-only, so fonts are self-hosted.
- **Favicons:** from `public/brand` (ico, 32/64/256/512 png, apple-touch from 256, manifest).
- **Accessibility:**
  - A skip link.
  - One `h1` per page.
  - Visible focus.
  - Labels on every input (never placeholder-only).
  - Keyboard menus.
  - Focus trap in dialogs.
  - Reduced-motion paths.
  - 24 px minimum tap targets.
  - AA contrast.

## 6. Verification

- `npm run build` (tsc + vite + prerender) passes.
- Backend:
  - `python -m compileall web`.
  - An import smoke test of `main.py` in a venv outside the repo.
  - Small pytest checks for the pure logic: UA parsing if it is server-side, tier matrix, email-change token flow if it can be tested without Postgres.
- The awwwards QA loop on a production build with `VITE_MOCK_API=1`:
  - `shoot.mjs --crawl --nav` and `audit.mjs`.
  - At least two passes.
  - A fresh critic subagent each pass.
- Targets: every critic score at 8 or above, zero audit FAILs, zero serious axe violations, mobile LCP under 2.5 s, CLS under 0.05.
- Run `pstack:thermos` on the full diff before the final commit.

## 7. Work split (agents, disjoint files)

| Wave | Agent | Owns |
|---|---|---|
| 1 | Backend | `web/**`, `mail/**`, migrations |
| 1 | Frontend core | design system port, tokens, fonts, i18n, router, layouts (public header/footer, app shell), API client + mock mode, prerender, nginx, favicons |
| 2 | Home | the home page, radar driver, chapters, page transition, 404 |
| 2 | Public pages | download, pricing, changelog, help |
| 2 | Account + cabinet | auth pages, `/account/*` |
| 2 | Admin | `/admin/*` |
| 3 | QA | awwwards QA loop, critic, fixes, thermos, commit |
