# Frontend: notes for page work

Vite 5, React 18, react-router 6 and TypeScript, with plain CSS and design tokens (no Tailwind). Public pages are prerendered to HTML at build time. The cabinet and admin are a SPA.

## Run

```bash
npm install
npm run dev:mock        # dev server with the mock API (no backend needed); /__ui lists every component
npm run dev             # dev server, /api proxied to https://watchdemo.pro
npm run build           # tsc + client build + server build + prerender -> dist/
npm run build:mock      # the same with VITE_MOCK_API=1 (QA screenshots only, never deploy)
npm run serve           # serve dist/ like nginx does, on :4400
npm run check           # every src/**/*.check.ts (plain node:assert scripts)
npm run og              # re-render public/og.png from a running mock build (see scripts/og.mjs)
```

## Where things live

| Path | What |
|---|---|
| `src/styles/tokens.css` | Every colour, radius, type size, spring easing and duration. Use `var(--…)`, never raw hex. |
| `src/styles/components.css` | The app's classes, ported 1:1 and split by group in `styles/ui/`: `btn-*`, `island`, `card`, `section`, `seg`, `input`, `list-row`, `pill`, `note`, `table`, `modal-*`. Buttons nudge an icon on hover with `nudge-down`, `nudge-out` or `nudge-spin` on the svg. |
| `src/styles/layouts.css` | Public header and footer, app shell, curtain. Put page CSS in your own file next to the page and import it there. |
| `src/ui/` | React components; import from `src/ui`. Live demo at `/__ui`. |
| `src/pages/**` | One file per route, with a default export. |
| `src/router/routes.tsx` | The route table. You should not need to touch it. |
| `src/api/endpoints.ts` | One typed function per endpoint (`authApi`, `meApi`, `appApi`, `adminApi`). Types are in `api/types.ts`. |
| `src/i18n/` | Dictionaries and hooks. |
| `src/head/` | `<Head>` (per-page meta) and the JSON-LD helpers. |
| `src/engine/` | GSAP + Lenis engine: one clock, page lifecycle, curtain transition. |
| `src/lib/` | `useAsync` (with `reload` and `mutate`), `useForm`, `useLatestRelease`, `format` (dates, relative time, bytes, prices), `userAgent` (`deviceName` for sessions), `notes` (the safe release-notes parser behind `Markdown`). |
| `src/config.ts` | Site URL, Telegram links, the "get access" URL. |

Old page implementations (before the redesign) are in git: `git show HEAD:frontend/src/pages/admin/PublishRelease.tsx`.

## Components (src/ui)

- `Button` takes `variant` (`primary` / `soft` / `ghost` / `danger`), `size="lg"`, `block` and `loading`. `IconButton` needs `label`, which becomes its aria-label and tooltip. `ButtonLink` takes `to` (an unprefixed route) or `href` (an external URL or a /releases file).
- `Island` and `Card` (`raised` for popovers) are the surfaces. `Divider` is the hairline.
- `Seg` is a radio group and `Tabs` are in-page tabs; both use roving tabindex and arrow keys. Pass `idBase` to `Tabs` and spread `tabPanelProps(idBase, value)` on the panel. `SegNav` holds tabs that are routes.
- `Field` takes `label`, `hint`, `error`, `required` and `optionalText`, and wraps one `Input`, `Select` or `Textarea`. `Checkbox` and `Switch` carry their own label.
- `Menu` takes `trigger={(p) => <button {...p}/>}`. Fill it with `MenuItem` (`onSelect`, `to` or `href`), `MenuSeparator` and `MenuLabel`.
- `Dialog` takes `open`, `onClose`, `title`, `footer` and `busy` (an action is running: Esc, the backdrop and the close button do nothing); put `data-autofocus` on the field that should get focus first. `ConfirmModal` takes `confirmLabel`, which names the action ("Удалить аккаунт"), plus `variant="danger"`, `busy`, and either `onConfirm` or `formId` (the confirm button submits the form inside `message`).
- `InlineRename`.
- `Logo` (with `intro`), `LogoLoader` and `MiniLoader`.
- `Markdown` renders release notes and help answers (`lib/notes`: paragraphs, lists, `#` headings, bold, code, links; never HTML). `CopyButton` takes `text` and `label`, plus `icon` for the small table variant.
- `Skeleton`, `DelayedReveal` (`delay` in ms), `Pending` (a server-rendered wait: the mini loader after 100 ms, its skeleton children after 1 s), `EmptyState` (always pass an `action`), `LoadError` (`text` and `onRetry`), `Note` (`tone`: a message inside a form or page), `useToast()` (inside `ToastProvider`, which is already mounted).
- `Pill` (with `tone`), `TierBadge`, `RoleBadge`, `Table` (give it a `label`, then thead/tbody; put `className="num"` on numeric cells), `Pagination` and `Stat`.

Loaders follow the app: nothing under 100 ms, `MiniLoader` up to 1 s, a skeleton beyond that. Wrap the skeleton in `<DelayedReveal>`.

## Strings (i18n)

Russian lives at unprefixed paths and English under `/en/...`. The locale comes from the URL.

- Shared strings are in `src/i18n/ru.ts` and `en.ts`: `const t = useT(); t.nav.download`. `en.ts` is typed from `ru.ts`, so tsc fails if a key is missing.
- Page strings go in `src/i18n/pages/<page>.ru.ts`, which has a default export, and `<page>.en.ts`, typed `typeof ru`. Read them with `const p = useDict({ ru, en })`. Seed files exist for home, download, pricing, changelog and help, each with `meta.title` and `meta.description`.
- `fmt(t.footer.version, { version })` fills placeholders, `plural(locale, n, { one, few, many })` picks a plural form, and `useLocale()` returns the locale.
- Links: `<LocalLink to="/download">`, or `useLp()('/download')`. `to` props on ui components are unprefixed and localized for you.
- `formatDate`, `formatDateTime`, `formatShortDate`, `formatMonth`, `formatRelative`, `formatBytes`, `formatNumber` and `formatPrice` in `lib/format.ts`. Tier feature names are shared: `t.feature[id]`.

## Head and SEO

Render `<Head title description jsonLd noindex image />` once per page. Omit `title` on the home page. The prerender collects it into the HTML, and in the browser it rewrites the tags marked `data-head`. Canonical, hreflang (ru, en, x-default), Open Graph and Twitter tags are built from the current path. `softwareAppLd(locale)` from `head/jsonld.ts` gives the SoftwareApplication JSON-LD. Cabinet, admin and auth pages pass `noindex`.

A prerendered page renders its static shell on the server and loads live data (version, changelog, tiers) on the client with `useAsync`. The first client render must match the server render, so start from the loading state. Never read `window` or `localStorage` during render.

## Motion engine

There is one clock: `gsap.ticker` drives Lenis and ScrollTrigger. Never call `addEventListener('scroll')` or start your own requestAnimationFrame loop.

```tsx
import { usePage } from '../engine/react'
import { gsap, ScrollTrigger, ease, scrollToTarget, lockScroll, prefersReducedMotion } from '../engine'

usePage(({ intro }) => {                       // runs after the engine sets up the page
  ScrollTrigger.create({ trigger: '[data-stage]', start: 'top top', end: '+=300%', pin: true,
    scrub: true, invalidateOnRefresh: true, onUpdate: (s) => driver.set(s.progress) })
  intro.add(gsap.from('.hero-meta', { autoAlpha: 0, y: 16, ease: ease.settle }), 0.3)
  return () => {/* remove window listeners you added */}
}, [])                                        // tweens and triggers are reverted on unmount
```

- Markup attributes: `data-reveal="up|fade|clip|scale"`, `data-split="lines|words|chars"` (only on text React never re-renders), `data-intro` (plays with the page intro), `data-delay`, `data-parallax`.
- Under reduced motion there is no Lenis, no scrub and no reveals. `prefersReducedMotion()` tells you which mode you are in.
- The curtain transition (the logo corners converge, then spread open; 560 ms, or a 150 ms fade under reduced motion) runs between prerendered public pages. `setTransition({ leave, enter })` from `engine` replaces it; call it once at module level. `data-no-transition` on a link skips it.
- Never put a CSS `transform` on an element GSAP animates. Use the `translate`, `rotate` and `scale` properties, or `gsap.set`.
- `lockScroll()` returns a release function. Dialogs and the mobile menu already call it.

## API and mock mode

- Every error body carries a stable `code` (`docs/ERROR-CODES.md`, mirrored as `Code` in `api/errors.ts`; `npm run check` fails when they drift). Every call throws `ApiError` with a `message` localized by that code, the HTTP `status`, `code`, `fields` (field name to message, from a 422 `validation_failed`) and `retryAfter` / `attemptsRemaining`. Branch on `err.code`, never on the server's text.
- Forms use `lib/useForm`: `onSubmit(fn)` validates, sets `submitting`, and puts a thrown `ApiError` under its field (422 fields by name, others by the `codeToField` map) or into `failure`. Field rules (`passwordError`, `usernameError`, `emailError`) are in `features/auth/rules.ts`.
- Mock mode (`dev:mock` / `build:mock`) runs an in-memory backend: 41 users, stats, 30/90-day timeseries, releases (0.7.6 with notes, plus a beta), audit log, and sessions (this browser, the desktop app with a UA and one without, Firefox, iPhone). Mutations persist until reload.
  - Choose the signed-in persona on `/__ui`, with `?mock-user=pro` on the first URL, or set `localStorage['wd-mock-user']` to `admin` (default), `moderator`, `support`, `pro`, `free` or `anon`. Moderator and support see the admin sections their role allows (SPEC §1).
  - Set the delay with `localStorage['wd-mock-delay']` (ms, default 280).
  - These inputs return errors: password `wrong` gives 401 with attempts left, `locked` gives 429, login `unverified` gives 403, username `taken` gives 409, a new password under 10 characters, without A-Z or without a digit gives a 422 `password_weak`, current password `wrong` (change password, change email, delete account) gives 403, and token `bad` or `expired` gives an invalid or expired link.
- Normal builds compile the mock out (`__MOCK__` is false). After a build, `grep -r wd-mock dist` prints nothing.

## Conventions

- One primary action per screen. Every other button is soft or ghost.
- Buttons and menu items start with a verb: «Скачать для Windows», «Сменить пароль», «Удалить аккаунт». Never "OK", "Submit" or "Да".
- Sentence case. No em or en dashes in visible text. No eyebrow labels over headings. No "→" in labels.
- One `h1` per page. Every input has a visible label, and placeholders only show a format. Validate on blur and clear the error on edit.
- Error text never blames the user and always says what to do next.
- Hover styles go inside `@media (hover: hover)`. Every hover has a matching `:focus-visible` state. Tap targets are at least 24 px.
- Prices are placeholders (SPEC §0). "Получить доступ" links to `GET_ACCESS_URL` (Telegram).
