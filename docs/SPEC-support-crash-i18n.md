# Support, crash reports, app i18n: spec

Branches: `feat/support-crash-i18n` in both repos (local only, no push, no deploy).
Repos: site `C:\Users\user999\PycharmProjects\watchdemo-web` (React in `frontend/`, FastAPI in `web/`), app `D:\demo-manager` (Tauri 2, Svelte 5 in `src/`, Rust in `src-tauri/`).
Status: approved through the interview on 2026-10-24.

## 0. Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Admin users list scroll | Root cause: Lenis smooth scroll swallowed wheel events on nested scrollers. Fixed with `allowNestedScroll: true` in `frontend/src/engine/scroll.ts`. The list scrolls itself, then hands off to the page at its end. Fixes the sidebar, chart and audit tables too. Done on the base branch. |
| 2 | Space in 2D replay | Window keydown in `Replay2d.svelte` toggles `playing`. Skipped in text fields and under open modals; works on focused range sliders; `preventDefault` stops the native button click. Done on the base branch. |
| 3 | App language | RU and EN. First run follows the system language (`ru`, `uk`, `be`, `kk` give RU, anything else EN). The choice lives in `localStorage["wd.locale"]`, not in the account, so login and updater windows follow it. Switcher in Settings and on the login screen. Switches without restart. |
| 4a | Who sends crash reports | Only after a click in the crash dialog. Logged in: report carries the user id. Logged out: anonymous with `install_id`. No auto-send setting. |
| 4b | Native crashes | Phase 1 detects them with a `running.lock` file (unclean exit) and sends the log tail. Minidumps are phase 2 and out of scope. |
| 4c | Triage model | Reports group by server-computed fingerprint. Status `new` / `in_progress` / `resolved` lives on the group. A report from a version newer than `resolved_in_version` moves a resolved group back to `new` (regression). Admin role only. |
| 4d | Symbols | PDBs never ship to users. `scripts/publish-release.ps1` uploads the release PDB; the server symbolicates module offsets. |
| 5 | Anti-tamper | Delete `adapters/security/anti_debug.rs` and `integrity.rs` and their call sites. Keep `obfstr` and `tier_guard`. |
| 6a | Ticket threading | At most one non-closed ticket per contact. Statuses `open`, `pending` (waiting on customer, set when staff replies), `resolved`, `closed`. A customer message reopens `pending`/`resolved` to `open`. `resolved` becomes `closed` 72 h after `resolved_at`. `pending` idle 7 days becomes `resolved`. A message when only closed tickets exist creates a new ticket. Both windows are config values. |
| 6b | Channels | Web and Telegram are separate contacts. No account linking. |
| 6c | Staff alerts | Only an unread badge on the admin "Support" nav item. No Telegram group alerts. |
| 6d | Attachments | Images only (png, jpeg, webp), 10 MB max, both directions. |
| 6e | Who sees Support | Roles `support`, `moderator`, `admin`. Customers see one continuous chat, never ticket status. |
| 6f | Where customers write | Website: a chat block at the bottom of the Help page, rendered only for logged-in users. Telegram: https://t.me/watchdemopro_bot, which first points to the Help page. |
| 7 | SmartScreen | The only legal entity is in Russia, so no trusted code-signing cert is available now. Deliver a step-by-step guide covering mitigations and the future signing path. |

## 1. App: i18n (`D:\demo-manager`)

Infrastructure is on the base branch:

- `src/lib/i18n/index.svelte.ts` exports `t(key, params)`, `tDynamic`, `plural`, `setLocale`, `i18n.locale`, `LOCALES`.
- `src/lib/i18n/ru.ts` is the source shape (`Dict`), and `en.ts` must match it.
- `src/lib/errors.ts` exports `errorText(e)`.

Work:

1. Move every user-facing string in `src/**/*.svelte` and `src/**/*.ts` into the dictionaries, namespaced by screen (`common`, `login`, `updater`, `library`, `profile`, `replay`, `settings`, `search`, `moments`, `notes`, ...). That is about 470 strings in 49 components. Use `plural` for counted nouns. Format dates and numbers with `Intl` and `i18n.locale`. `radar.ts:351` `localeCompare("ru")` follows the locale.
2. Replace every `showToast(String(e))` and similar raw-error display with `errorText(e)`. Add `errors.<CODE>` entries for every code in section 2.2.
3. Settings: a "Language" select in the general section of `SettingsModal.svelte`. Login window: a small RU/EN switch.
4. Rust strings shown to users:
   - Window titles in `tauri.conf.json` become neutral ("WatchDemo"). The frontend sets the localized title at runtime with `getCurrentWindow().setTitle`.
   - The native MessageBox in `services/analysis.rs` and `adapters/ipc_events/tauri_events.rs` takes text from a tiny Rust table keyed by locale. Add a `set_locale(locale: String)` command that stores it in app state. The frontend calls it on start and on every switch.
   - Toasts in `services/playback.rs` and the updater adapter messages move to codes or locale-aware text the same way.
5. `index.html` `lang` is set at runtime by the i18n module.
6. Check: a vitest or node script that asserts `ru` and `en` have identical key sets and no empty strings. Plus `npx svelte-check` clean. Plus a grep check that no Cyrillic literals remain in `src/**/*.svelte` outside dictionary files (a short allowlist is fine).

## 2. App: crash and error system

### 2.1 Logging

- Keep `tracing` and the existing text format in `adapters/observability/logging.rs`.
- Add retention: keep at most 14 daily files and 100 MB total. Prune at startup.
- First line of each session: app version, OS build, WebView2 version, session id (UUID per launch), install id.
- Add a breadcrumb ring buffer: the last 100 INFO+ events (IPC command names, navigation, errors) in a `Mutex<VecDeque>`, fed by a tracing layer.
- `install_id`: a UUID created once in `app_data_dir/install_id`.

### 2.2 Error codes

`AppError` gets `fn code(&self) -> &'static str` and serializes as `{"code","message","params"?}`. Codes are stable and never reused. Document them in `D:\demo-manager\docs\ERROR-CODES.md`.

| Variant | Code | params |
|---|---|---|
| Io | WD-IO-001 | |
| Db | WD-DB-001 | |
| Migrate | WD-DB-002 | |
| Zip | WD-ARC-001 | |
| SevenZ | WD-ARC-002 | |
| Rar | WD-ARC-003 | |
| Zstd | WD-ARC-004 | |
| Bzip2 | WD-ARC-005 | |
| NoDemosFound | WD-DEMO-001 | |
| DemoNotFound | WD-DEMO-002 | |
| GroupNotFound | WD-DEMO-003 | |
| Parse | WD-DEMO-004 | |
| SteamNotFound | WD-CS2-001 | |
| Cs2NotFound | WD-CS2-002 | |
| Invalid | WD-CORE-010 | |
| Other | WD-CORE-099 | |
| NotAuthenticated | WD-AUTH-001 | |
| InvalidCredentials | WD-AUTH-002 | |
| TierRequired | WD-AUTH-003 | tier |
| MonthlyLimitReached | WD-AUTH-004 | tier, used, limit |
| Network | WD-NET-001 | |
| Server | WD-NET-002 | |
| UpdateFailed | WD-UPD-001 | |
| SecureStorage | WD-SEC-001 | |

Crash kinds have their own codes:

| Code | Kind | Meaning |
|---|---|---|
| WD-CORE-001 | `panic` | Rust panic |
| WD-CORE-002 | `unclean_exit` | Previous session ended without a clean exit (native crash, kill, power loss) |
| WD-UI-001 | `frontend` | Root `<svelte:boundary>` caught a render or effect error |
| WD-WEB-001 | `webview` | WebView2 `ProcessFailed` (best effort; skip if wry gives no hook) |

`src/lib/cs2.svelte.ts` stops matching English Display strings and matches codes instead.

### 2.3 Capture

- **Panic hook** (installed first thing in `run()`, before Tauri starts):
  - Write `app_data_dir/crashes/<report_id>.json` synchronously, using the report schema in 2.5 minus `user_comment`.
  - Frames come from the `backtrace` crate. Send raw IPs as `{module, offset}`, where the offset is relative to the main exe base, and only for frames inside the main exe. Also send `location` (file:line:col) and the message.
  - Then emit `crash://new` if the app handle exists, so a living process shows the dialog now.
  - Keep logging it through tracing.
- **Unclean exit:**
  - At start, write `app_data_dir/running.lock` holding the session id and start time.
  - Remove it on clean exit, in the `RunEvent::Exit` handler. The `CloseRequested` handler calls `app.exit(0)`, so that path is clean. The updater install path must remove it before the process quits.
  - If the lock exists at start, create an `unclean_exit` report with the log tail of that session.
  - If a panic file for the same session already exists, skip, since the panic report covers it.
- **Frontend:**
  - `devlog.ts` keeps logging `error` and `unhandledrejection` to the file. No dialog for those.
  - Add a root `<svelte:boundary>` in `App.svelte`, `LoginApp.svelte` and `UpdaterApp.svelte`. On failure it creates a `frontend` report through a `crash_record_frontend` command and shows the dialog with a "Reload" action.
- **WebView2:** try `webview.with_webview` and `webview2-com` to subscribe `ProcessFailed`. On fire, log, write a `webview` report and reload. If this needs more than about 60 lines, skip it and note it in the PR.
- **Scrubbing** (applied when the report is built):
  - Replace `C:\Users\<name>` with `%USERPROFILE%`.
  - Replace the Windows username and the computer name.
  - Redact emails, `Bearer ...` tokens, JWT-shaped strings and 17-digit Steam ids.

### 2.4 Dialog and upload

- Commands:
  - `crash_pending() -> Vec<CrashSummary>`
  - `crash_preview(id) -> String`, the exact scrubbed JSON that will be sent
  - `crash_send(id, comment: Option<String>)`
  - `crash_dismiss(id)`
  - `crash_record_frontend(payload)`
  - `open_logs_folder()`
- `CrashDialog.svelte` is mounted in the main and login windows and shows the first pending report. Contents:
  - title and plain-language explanation, with the code shown;
  - an expandable "What will be sent" section that renders `crash_preview`;
  - a comment textarea;
  - buttons "Send report", "Don't send" and "Open logs folder".

  Sending or dismissing deletes the file. Each report is shown once. At most 5 pending files are kept; the oldest are dropped.
- Upload is in Rust through the existing `reqwest` client and base URL (`adapters/http`). Request: `POST /api/v1/crash-reports` with a gzip body, sending `Authorization: Bearer` when a session exists. On network failure, keep the file and show an error toast.
- Remove the anti_debug and integrity modules (decision 5) on this branch, so a silent `exit(0)` never looks like a crash.

### 2.5 Report schema (shared contract with the server)

```json
{
  "report_id": "uuid v4, idempotency key",
  "kind": "panic | unclean_exit | frontend | webview",
  "error_code": "WD-CORE-001",
  "message": "string, <= 4 KB",
  "location": "src/x.rs:12:5 or null",
  "frames": [{"module": "watchdemo.exe", "offset": "0x1a2b3c"}],
  "js_stack": "string or null, <= 32 KB",
  "app_version": "0.8.1",
  "os_version": "Windows 11 26100",
  "webview_version": "130.0.2849.80 or null",
  "locale": "ru",
  "install_id": "uuid",
  "session_id": "uuid",
  "occurred_at": "RFC 3339",
  "breadcrumbs": [{"ts": "RFC 3339", "category": "ipc", "message": "list_demos"}],
  "log_tail": "string, <= 256 KB, scrubbed",
  "user_comment": "string or null, <= 2000 chars"
}
```

`frames` has at most 128 entries, and `breadcrumbs` at most 100. The server rejects unknown `kind` values with 422.

### 2.6 Release symbols

- `[profile.release]` gets `debug = "line-tables-only"`. On MSVC the info goes to the separate `.pdb`, and the installer does not include it.
- `scripts/publish-release.ps1` uploads the PDB and the exe after the release upload, to `POST /api/v1/admin/releases/{version}/symbols` (multipart: `pdb`, `exe`).

## 3. Site backend (`web/`)

### 3.1 Crash ingestion

- Alembic revision `0003_crash_reports`, `down_revision = "0002_locale_changelog"`.
- Tables:
  - `crash_groups(id uuid7, fingerprint text unique, error_code, kind, title, status new|in_progress|resolved, resolved_in_version null, notes text, first_seen, last_seen, report_count, last_app_version)`
  - `crash_reports(id uuid7, report_id uuid unique, group_id fk, user_id null fk users on delete set null, install_id, app_version, kind, error_code, occurred_at, received_at, ip_hash, payload jsonb, symbolicated jsonb null)`
  - Indexes on `crash_groups(status, last_seen)`, `crash_groups(error_code)`, `crash_reports(group_id, received_at)`, `crash_reports(received_at)`.
- `POST /api/v1/crash-reports`. Auth is optional: a valid Bearer token sets `user_id`, and a missing or invalid one means anonymous (never 401).
  - Limits: 1 MB on the wire, 3 MB after gzip. Decompress in a streaming way and stop at the cap.
  - Rate limit 10 per hour per IP and per `install_id`, through the existing limiter.
  - Insert with `ON CONFLICT (report_id) DO NOTHING`, so retries return the same answer: `202 {"report_id", "group_id"}`.
- Symbolication:
  - Symbols live on a new volume `watchdemo_symbols_data`, mounted only in `web`. Never on the public releases volume.
  - Layout: `/symbols/<version>/watchdemo.pdb` (and exe).
  - Resolve `frames` with `llvm-symbolizer` (add `llvm` to `web/Dockerfile`) against that version's PDB, at ingest time. Store the result in `symbolicated`. If symbols are missing, store null; the admin UI shows raw offsets plus `location`.
  - The implementer must prove it on a real release PDB built from `D:\demo-manager`.
- Fingerprint, computed on the server:
  - `sha256(error_code + "|" + top 5 symbolicated in-app function names)`, with hashes (`::h[0-9a-f]{16}`), closure numbers and addresses stripped.
  - Fallback without symbols: `error_code + location`.
  - Fallback for `unclean_exit`: `error_code + app_version`.
  - Fallback for `frontend`: `error_code` plus the first stack line with digits stripped.
- Regression: a report with `app_version > resolved_in_version` (semver compare) sets a resolved group back to `new`.
- `POST /api/v1/admin/releases/{version}/symbols`. Admin only, multipart `pdb` and `exe`, size cap 300 MB, written to the symbols volume.
- Admin API (admin only):
  - `GET /admin/crashes?status=&kind=&error_code=&version=&from=&to=&sort=last_seen|count&page=`
  - `GET /admin/crashes/{group_id}`, which returns the group plus its last 50 reports, without payloads
  - `GET /admin/crashes/reports/{id}`, which returns the full payload and symbolicated stack
  - `PATCH /admin/crashes/{group_id}` with `{status?, notes?, resolved_in_version?}`. Status changes go to `audit_log`.
- Retention: delete `crash_reports` older than 90 days in the periodic task (3.3). Groups stay.
- Add new error codes to `ErrorCode` and `docs/ERROR-CODES.md` (the existing drift test enforces it).

### 3.2 Support

- Alembic revision `0004_support`, `down_revision = "0003_crash_reports"`.
- Tables:
  - `support_contacts(id uuid7, channel web|telegram, user_id null unique fk users, tg_user_id bigint null unique, tg_chat_id bigint null, tg_username, display_name, locale, blocked_at null, created_at)`, with a check that exactly one identity matches the channel.
  - `support_tickets(id uuid7, number serial unique, contact_id fk, status open|pending|resolved|closed, assignee_id null fk users, unread_count int default 0, waiting_since null, first_reply_at null, resolved_at null, closed_at null, last_activity_at, created_at)`. Partial unique index `(contact_id) WHERE status <> 'closed'`.
  - `support_messages(id uuid7, ticket_id fk, direction in|out|note, author_id null fk users, body text, image_path null, image_mime null, tg_message_id bigint null, delivery sent|failed null, delivery_error null, edited_at null, created_at)`.
- Inbound routing (one function, used by web and Telegram):
  1. Find the contact's non-closed ticket.
  2. If it is `resolved` and `resolved_at` is older than 72 h, close it and treat it as absent. This check makes the 72 h window exact even between periodic task runs.
  3. Append the message. Set status `open`, increment `unread_count`, set `waiting_since` if null, bump `last_activity_at`.
  4. If there is no ticket, create one. Catch a unique violation from the partial index and retry once (race safety).
- Staff reply:
  - Insert an `out` message, set status `pending`, clear `waiting_since`, set `first_reply_at` if null, and set the assignee to the replier if none.
  - Deliver it to the contact's channel. Web: nothing to push, since the widget polls. Telegram: `sendMessage` or `sendPhoto`. On a 403, set `contact.blocked_at` and mark the message `delivery=failed` with the reason. On a 429, wait `retry_after` and retry once.
  - Notes (`direction=note`) are never delivered.
- Customer API (any logged-in role):
  - `GET /api/v1/support/messages?after=<id>` returns the user's whole stream across all their web tickets, oldest first, without notes. It carries only `{id, direction, body, image_url, created_at}`.
  - `POST /api/v1/support/messages`. Multipart: `body` (1 to 4000 chars) and an optional `image`. Rate limit 20 per minute.
  - `GET /api/v1/support/images/{message_id}`. Allowed for the owner or staff. Sends `Content-Type` from the stored mime, `X-Content-Type-Options: nosniff`, and `Content-Disposition: inline`.
- Staff API (`support` and above):
  - `GET /admin/support/tickets?status=&channel=&q=&page=`. Defaults to non-closed, sorted unread first, then by `waiting_since`.
  - `GET /admin/support/tickets/{id}` returns the ticket, its messages, and the contact. For a web contact it adds the user's email, tier and a link. For Telegram it adds the username and id, plus the contact's other tickets.
  - `POST /admin/support/tickets/{id}/messages` with `{body, note: bool}` and an optional image.
  - `PATCH /admin/support/tickets/{id}` with `{status?, assignee_id?}`. Manual `resolved` sets `resolved_at`. Manual `closed` is allowed.
  - `POST /admin/support/tickets/{id}/read` zeroes `unread_count`.
  - `GET /admin/support/unread` returns `{tickets: n}`, the number of tickets with `unread_count > 0`.
- Images:
  - Validate by magic bytes (png, jpeg, webp), cap at 10 MB, and re-check the mime.
  - Store at `/support/<yyyy>/<mm>/<uuid>.<ext>` on a new volume `watchdemo_support_data`, mounted only in `web`.
  - Never serve them from nginx.

### 3.3 Periodic task

One asyncio loop started in the FastAPI lifespan runs every 5 minutes. Every step is idempotent.

1. `resolved` tickets with `resolved_at < now - 72h` become `closed`.
2. `pending` tickets with `last_activity_at < now - 7d` become `resolved`.
3. Crash reports older than 90 days are deleted.

Use a Postgres advisory lock so that only one worker runs each pass.

### 3.4 Telegram bot

- Call the raw Bot API with `httpx`, which is already present through `fastapi[standard]`. No bot framework.
- Settings:
  - `TELEGRAM_BOT_TOKEN`: this exact name, already in `.env`.
  - `TELEGRAM_WEBHOOK_SECRET`.
  - When the token is absent, the bot is disabled and the webhook returns 404.
- `POST /api/v1/telegram/webhook`: compare the `X-Telegram-Bot-Api-Secret-Token` header with `hmac.compare_digest`, and return 401 on mismatch. Always answer 200 quickly after handling.
- Dev runner: `python -m APP.telegram_poll` uses long polling with `getUpdates` and the same handler.
- Behavior (language from `from.language_code`, `ru`/`uk`/`be`/`kk` giving RU, else EN):
  - `/start` greets the user. It says to try the Help page first, with an inline URL button to https://watchdemo.pro/help (or /en/help), and explains that any message here reaches support.
  - Text or photo goes to inbound routing. Take the largest photo size, use `getFile`, download it if 10 MB or less, and store it like web images.
  - The first message of a new ticket gets a short reply in the user's language: received, we answer here.
  - Other content (documents, voice, video, stickers) gets a reply: only text and images.
  - `edited_message` updates the body and sets `edited_at`.
  - Any inbound message clears `blocked_at`.
- `docs/DEPLOY.md` documents the webhook command (`setWebhook` with `secret_token` and `allowed_updates=["message","edited_message"]`). It is not run by us.

## 4. Site frontend (`frontend/`)

- Nav entries in `SHELL_NAV`: "Support" (`minRole: 'support'`, with the unread badge polled every 30 s) and "Crashes" (`minRole: 'admin'`). Routes `/admin/support(/:id)` and `/admin/crashes(/:id)` use the same role gates. Strings go in the admin dictionaries, RU and EN.
- **Crashes list:** a group table with filters status, kind, error code, version and date range (native `<input type="date">`), sorted by last seen or count. Filters live in the URL like `Users.tsx`. Status pills: new (danger), in progress (warning), resolved (success).
- **Crash group detail:**
  - header with the status select, notes, `resolved_in_version` and counters;
  - the symbolicated stack, or raw offsets with a "no symbols for X" note;
  - recent reports.
  - A report row expands to its breadcrumbs, log tail (monospace, scrollable), comment, user email or "anonymous", OS and WebView.
- **Support inbox:**
  - Split pane: a ticket list (number, contact name, channel icon, preview, waiting time, unread dot) and the thread.
  - Composer with a "Note" toggle and image attach.
  - Status and assignee controls.
  - Contact card: web shows email, tier and a link to the user page; Telegram shows the @username.
  - Polls every 10 s while visible. Opening a ticket calls `read`.
- **Help page:** below the FAQ, logged-in users see a "Didn't find an answer? Write to us" chat block. Guests see nothing.
  - The chat shows the message stream, a composer with image attach, and a "we usually reply within a day" hint.
  - It polls `GET /support/messages?after=` every 10 s while visible.
  - Strings go in `help.ru.ts` and `help.en.ts`.
  - Prerendering must not include the chat, which is client-only and auth-gated.
- **Mock API:** add fixtures to `frontend/src/api/mock/` for the new endpoints, so the pages work with `VITE_MOCK_API=1`.

## 5. Deploy notes (written into `docs/DEPLOY.md`, not executed)

1. Back up the DB.
2. Pull.
3. Add the volumes `watchdemo_symbols_data` and `watchdemo_support_data`.
4. Rebuild `web` for `llvm`.
5. Run `alembic upgrade head`, which applies 0003 and 0004.
6. Set `TELEGRAM_WEBHOOK_SECRET` and run `setWebhook`.
7. Restart `web` and rebuild `frontend`.
8. App release: build, run `publish-release.ps1` (it uploads the symbols), and verify that a test panic report symbolicates.

## 6. Out of scope

- Minidumps.
- Telegram account linking.
- Staff Telegram alerts.
- Non-image attachments.
- SSE or websockets.
- Code signing purchase.
