# Карта контрактов и проверок модулей

Статус: план с gates утверждён пользователем (D24). Реестр обязанностей; прохождение перечисленных проверок фиксируется отдельно.

Эта матрица задаёт обязательства, а не утверждает прохождение проверок. Новые baseline, DOM, visual и native gates пока не выполнены. «Существующие проверки» — найденные тесты; фактические результаты перечислены в REFACTOR-SPEC.md. Для каждого изменяемого модуля сначала фиксируется текущее поведение. Неизменяемые модули также получают явный статус в итоговом реестре.

Продуктовые исключения согласовываются отдельно: D16 — desktop wipe_all; D17 — атомарность одноразовых auth-токенов при подтверждении гонки; D18 — безопасная публикация файлов релизов при подтверждении повреждения. Два последних решения относятся только к watchdemo-web. Остальные исправления поведения в предложениях ниже не разрешены. Точные решения и ограничения находятся в REFACTOR-SPEC.md.

## Module characterization matrix

Все пути ниже относительны `C:/Users/user999/PycharmProjects/watchdemo-web/`. «Существующее» означает coverage, установленное отчётами, а не новый запуск этой консультации.

Общий UI gate для каждой изменяемой страницы: RU/EN, ready/loading/error/empty, клавиатура и focus return, overlays, узкий экран, обычный и reduced-motion режим. Визуально проверять затронутые состояния, а не только default screenshot.

### Frontend

| Модуль и пути | Существующее | Исполняемые добавления до изменения |
|---|---|---|
| Composition: `frontend/src/main.tsx`, `frontend/src/App.tsx` | Route/prerender/browser harnesses | Client mount/hydration/StrictMode, provider readiness, отсутствие protected-content flash, remount cleanup |
| Routing: `frontend/src/router/` | Registry-driven build и исторический route QA | Direct/SPA/history, роли, redirects, query/hash, RU/EN 404 status, переход между разными ID одного route pattern |
| Shells: `frontend/src/layouts/` | Исторический Focus QA и mock roles | Header/mobile menu Escape/focus/scroll lock, app sidebar, logout/unread, длинные строки и breakpoint edges |
| Credentials: `frontend/src/api/client.ts`, `frontend/src/context/` | Сильный `client.check.ts`, auth browser fixture | React mounting, same-account reactivation, late 401, initial restore/logout, shared-cookie ordering и cross-tab |
| Error/transports: `frontend/src/api/` вне mock | `errors.check.ts`, client checks | JSON/XHR/blob error parity, abort/progress, unknown/malformed bodies, nullable/omitted values, exact headers |
| Async hooks: `frontend/src/lib/useAsync.ts`, polling/latest-release hooks | Прямого полного lifecycle oracle нет | Deferred initial/refresh/reload в обоих порядках, deps/unmount, visibility, retained data/error, cache lifetime. Зафиксировать известные stale cases отдельно |
| Form primitive: `frontend/src/lib/useForm.ts` | Form/rules и legal scenarios | Blur validation, duplicate submit, synchronous lock, server error mapping, draft edits during pending |
| Auth pages/features: `frontend/src/pages/` auth routes, `frontend/src/features/auth/` | `rules.check.ts`, legal browser QA | Autofill, missing/bad/expired token, token/query replacement, resend, unavailable/stale policy, neutral sent states |
| Shared helpers: `frontend/src/lib/format.ts`, `notes.ts`, `userAgent.ts` | Три соответствующих `.check.ts` | Сохранить boundary vectors, hostile URL/HTML, unknown UA и locale/null/zero; расширять только реальные пробелы |
| i18n: `frontend/src/i18n/` | Typed dictionaries, help check | Path/query/hash-preserving locale switch, API language, placeholder substitution, RU/EN renders и overflow |
| Motion engine: `frontend/src/engine/` | Исторические interaction/visual QA | Controlled clock enter/leave/reentry, delayed fonts/frame load, hidden/visible, cleanup. Новое cleanup-поведение отдельно |
| Home: `frontend/src/features/home/`, Home page | Anchors/hero/layout checks | Chapter screenshots при фиксированных times, seek/drag/cancel/keyboard, initial frame, fonts, sticky layout, back navigation |
| Radar: `frontend/src/features/radar/` | Изолированный software parity/perf driver | Полные frame/interpolation/trails/markers vectors; resize/DPR, repeated same-time render, fixed-time pixel crops; whole-page comparison отдельно |
| Background: `HomeBackground.tsx`, `GhostFibers/`, `clock.ts` | Исторический WebGL QA | Init success/failure, partial allocations, context loss, remount/intersection, visibility/preferences; deterministic render parity до decomposition |
| Focus preview: `frontend/src/features/focus/`, preview harness | Существующие preview QA | Mount/unmount, locale, input/keyboard и preview snapshots. Не удалять как production-inactive |
| Download/changelog: соответствующие pages/features | Notes checks, release fixtures | Eligibility/channel/cache states, empty/failure/retry, long hashes/notes, malformed hash reproducer, link/download contracts |
| Pricing: `frontend/src/features/pricing/`, Pricing page | Tier/prelaunch checks | Unknown/unlimited/monthly/anchor semantics и RU/EN cards/table; actual CTA states |
| Account/profile/security: account pages и `features/account/` | Часть ownership покрыта client checks | Rename/email/password/delete/revoke, stale completion после auth/route change, confirmation focus, multi-session list |
| Admin shell/lists: admin pages, `features/admin/parts.tsx`, charts/useAdmin | Access checks, mock fixtures | Actor-role matrix, filter URL/back-forward/debounce/page edges, long rows, empty/error/loading; существующие race reproducers отдельно |
| Admin user/reset: dialogs, controller, user detail | `groupResetController.check.ts`, access checks | Mounted wiring, A→B→A, uncertain outcome, replacement activation, exact busy/confirm states |
| Admin releases: Releases page, publish dialog/release helpers | `release.check.ts` | Upload/progress/signature/version, exact optimistic/rollback sequence и overlapping mutations. Исправление concurrency не включать |
| Crash pages/features | Mock crash fixtures | Route A→B draft identity, stack variants, symbols missing, large logs, save/error/filter states |
| Support UI: `frontend/src/features/support/`, user/staff pages | Mock support, частичный app QA | Initial/incremental/poll order, hidden/visible, unread/read, image blob cleanup, retries, mobile thread/composer/focus |
| Legal UI: `frontend/src/features/legal/`, legal pages/providers | Catalog/signupPolicy checks, legal browser/prerender QA | Draft/effective/unavailable, exact downloads/body hashes, cookie settings, print и focus. Не менять юридический текст |
| Head/SSR: `frontend/src/head/`, entry-server/build/prerender | Build/legal prerender scripts | Initial shell parity, canonical/hreflang/noindex, escaped JSON-LD, private-route exclusion, hydration console clean |
| Design system: `frontend/src/ui/`, `frontend/src/styles/`, feature CSS | Token checks, showcase, historical axe | Actual computed states и screenshot matrix; primary/danger hover contrast, reduced-motion cascade как отдельные known defects |
| Mock backend: `frontend/src/api/mock/` | Используется browser QA | Fixture integrity/reset, permissions, route/errors, mutation rollback; rejected support PATCH reproducer. Mock permissiveness не production auth contract |

### Backend

| Модуль и пути | Существующее | Исполняемые добавления / gate |
|---|---|---|
| API boundary: `web/API/`, exceptions/middleware | Backend/legal transport tests | Exact `{message,code,extra}`, 422/legacy detail, 429 headers, sanitized500, CORS и all auth/role gates |
| Auth/tokens: `auth_service.py`, token repo, auth views | Auth/backend/logout tests | Browser-cookie versus desktop-body precedence, expiry/errors; двухсоединительный one-time-token reproducer; mail/commit failure ordering |
| Session/revocation: session service/repos, Redis adapters | Logout races, stale-active/cache fallback | Read/write outage, rollback after tombstone, session ownership, account deletion и expiry TTL |
| Password/lockout boundary | Backend tests, Redis lockout coverage | Exact bcrypt acceptance/errors и lockout thresholds/reset clock. Bounded offload только отдельным измеренным изменением |
| User/admin/audit: services/repos/entities/routes | Role/self-target/backend tests | Полный actor×target×self matrix, omitted/null PATCH, concurrent uniqueness, audit+transaction outcomes |
| Subscription/tier: subscription service/repo, constants | Expiry/quota suites | Boundary paid/indefinite expiry, extension/reactivation, anchors, downgrade/count agreement |
| Quota: contract/periods/service/repos/models | Last-slot, batch, replay, identity-map suites | Keep all transition/concurrency vectors; generation resets, multilibrary,1000-item edge, exact snapshot/error wire |
| Entitlements: entitlement service/ports | Crypto tests | Fixed keys, wrong account/session/key/audience/algorithm, tamper, ≤24h/paid cap, missing/bad signing key |
| Legal catalog: loader/transport/generated catalog | Catalog/transport/entrypoint tests | Draft no-I/O, origin/redirect/size/timeout, tamper rejection, deterministic generated hash |
| Legal activation/evidence: legal service/models/migrations | Activation/immutability/concurrency tests | Parallel signup/activation, stale-worker monotonicity, evidence retention/delete survival, exact advisory-lock scope |
| Legal outbox/periodic | Legal periodic/service + mail consumer tests | Parallel publishers, broker-confirm then commit-loss replay, stable identity/time, suppression/batch boundaries |
| Support service/read models/routes | Substantial support tests | **Fixture safety first**; duplicate overlapping Telegram ingress, timing boundaries, first report wins, ticket/message uniqueness separately |
| Support storage/privacy | Public/internal/image routes, support tests | Own-only streams/images, note privacy, MIME/size, temp filesystem failures and exact write/commit/send sequence |
| Crash ingestion/grouping | Crash fixtures/tests | Safe collection first; gzip/wire/decompressed caps, invalid-bearer anonymous, duplicate report races, counters/retention/fingerprint |
| Crash symbols/storage | Symbol tests | Concurrent shared-temp reproducer, PDB/exe pair failure, timeout/cancel/fallback and exact existing cleanup |
| Release/updater: release service/repo/app/admin views | Version/release tests in existing suites |204/body, channels, eligibility, valid/invalid SemVer current vectors, digest/signature/served bytes; failed/concurrent upload reproducers |
| Rate limiter: `web/APP/rate_limiter.py` | No complete targeted oracle established | Fake monotonic clock, exact boundary allow/deny, many single-use keys/expired buckets; eviction is a separately approved optimization |
| MQ publisher: `web/SPI/mq_adapter/` | Consumer fake-transport tests | Durable/mandatory/persistent/confirm/return propagation, exact envelopes, broker failure before/after confirm |
| ORM/repositories/transactions: `web/SPI/db_adapter/` | PostgreSQL quota/migration/auth suites | Test through use cases/conformance, not empty per-model tests; constraints, lock ordering, NULL/order/rollback and cross-account isolation |
| Migrations: `web/migrations/` | Historical baseline and roundtrip tests | Fresh and historical upgrades, downgrade/re-upgrade, single head, data/constraints/triggers. No rewriting revision bodies |
| Runtime/config: `web/main.py`, dependencies/config/periodic | Selected lifecycle/source coverage | Configuration precedence, entrypoints, resource acquisition/failure sequence; cleanup correction outside equivalent extraction |
| Logging/errors/redaction | Backend tests/source coverage | Tokens/PII absent from captured logs/errors, exact public error mapping; do not change policy under comment cleanup |

### Bot, mail, generated content and infrastructure

| Модуль и пути | Существующее | Исполняемые additions/gate |
|---|---|---|
| Bot ingress: `bot/handlers.py` | Handler tests | Preserve private-human filter, largest image, size precheck, edit/dedupe IDs, locale and `/start` rendered link |
| Bot client: `bot/web_client.py` | Loopback client tests | Multipart recreation/retry headers, timeout/cancel,4xx/5xx and report behavior; no external endpoint |
| Bot consumer: `bot/consumer.py` | Consumer suite | Five-attempt/429/partial-send/report-only/settled semantics; real isolated broker restart/redelivery |
| Bot runtime/config/logger: remaining `bot/*.py` | Indirect unit coverage | Fake config/no dotenv, startup/stop resource order, safe logging; no Telegram call |
| Mail schema/templates: `mail/schemas.py`, templates/URL helpers | Schema/template tests | All7types×RU/EN, escaping/plain text, strict legal metadata, safe URLs/timezones/fallback; exact rendered snapshots |
| Mail provider: `mail/email_service.py` | Provider tests | Fake provider args, idempotency/privacy/error propagation; no real delivery |
| Mail consumer: `mail/consumer.py` | Consumer suite | Ack after confirmed durable handoff, retry/quarantine, five-attempt/one-hour/future-time boundaries; broker-level TTL/DLX/quorum |
| Mail runtime/config/logger | Indirect unit coverage | Isolated settings, connect/close/failure order, logs and shutdown |
| Shared envelopes: web producer + mail/bot consumer schemas | Independently validated DTOs | Shared **golden JSON fixtures** through producer and consumer; no shared runtime package required |
| Legal generator: `docs/scripts/build_legal_catalog.py`, catalog/fields/texts | Generator tests | No-write `--check`, canonical UTF-8/hash, immutable revisions, symlink/path rejection, all generated outputs agree |
| Build/serve/QA: frontend scripts + docs scripts | Existing check/build/browser scripts | Mode/origin guards, zero requests on reject, malformed URI/traversal, exact artifact output paths, no accidental production |
| Packaging: Dockerfiles, lockfiles, local helpers | Source review | Container import/entrypoint, dependency resolution and lock drift; separate vulnerability/license inventory |
| Runtime infrastructure: Compose/Traefik/CrowdSec/nginx | Source review | Effective headers/routes/request sizes/ports/volumes, local isolation, matching deployed broker semantics; no production config change without approval |

This covers executable module families, not every file as a separate unit. DTOs, traits, schemas and package initializers are exercised through their owning transport/service contract. Historical prototypes receive preservation/smoke coverage, not an automatic rewrite.
