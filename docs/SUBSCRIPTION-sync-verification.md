# Subscription synchronization verification record

Status: implementation completed and verified locally within the scope documented below. **Production rollout was not performed or approved by these checks.** The latest-state section supersedes older chronological notes, including earlier tool blocks, unrun tests and Rust-memory failures.

Contract: [Subscription synchronization specification](SPEC-subscription-sync.md).

**Post-deployment follow-up:** the later request-loop, missing-counter, login-control and mobile-replay corrections are recorded in [Subscription production regression audit](SUBSCRIPTION-production-audit.md). Its final results supersede overlapping counts below: 33 unique native tests, 25 desktop helper groups, 4 auth-store cases, 15 catalog/review cases, 18 web check scripts and rendered quota/chrome/mobile checks. Older results below describe the initial implementation, not proof that the subsequently reported regressions were absent.

## Latest state — 2026-11-05

The user explicitly authorized both repository trees and a larger Rust memory budget. The coordinator retained process-tree containment and one CPU, using **4,096 MiB only for Rust compilation/native checks**; other checks retain 1,024 MiB. No security or auto-mode configuration was changed.

| Actual check | Latest result |
|---|---|
| `cargo check --offline --locked -j 1`, `CARGO_INCREMENTAL=0`, 4 GiB | PASS, 14.43 s; seven unused-code/import warnings, no compile errors |
| `cargo test --offline --locked -j 1 --lib --no-run`, same containment | PASS on the final entitlement tree, 55.13 s; the earlier test-only E0505 pinned-future scope was corrected without changing the authorization race |
| Native `subscription` filter | 14/14 PASS, including SQLite denial fault/rollback/reopen recovery, actual auth-apply/serial 401 barriers and indefinite-paid lease regression |
| Native playbook-execution DTO filter | 2/2 PASS: required nullable aggregate and full totals independent of page-zero items |
| Native entitlement-signature filter | 2/2 PASS: bounded and indefinite paid subscriptions, required signed anchor/time window, invalid identity/key/nullable fields and historical Basic expiry; one case overlaps the subscription filter |
| Native updater filter | 10/10 PASS; mandatory/update-failure and cached transport-fallback cases use doubles |
| Desktop production TypeScript harness | 24 behavior groups PASS, including six new actual `NoteEditor`/draft cases and the observed-false ownership latch without explicit invalidation |
| Desktop `svelte-check` | 0 errors, 0 warnings after removing unsupported fieldset `aria-invalid`; validation description and focus target retained |
| Desktop localization checker | 714 matching EN/RU keys; 78 files free of Cyrillic literals |
| Pure server subscription runner | 7/7 PASS on the final tree, including 12 subcases immediately before/exactly at/after/null expiry across all tiers |
| Cold quota-service-first/API import | PASS in a fresh process with fake settings and application network connections denied |
| Actual Ed25519 signing pytest suite | 7/7 PASS with plugin autoload disabled and fake test settings; ephemeral test keys only |
| Disposable PostgreSQL 18.6 integration | 33/33 PASS in 27.28 s: migration/quota/identity-map suites plus 13 real logout route/service/revoker/repository cases, including expired access, cookie ownership and coordinated crossed-cookie concurrency; SCRAM cluster stopped and removed |
| Mounted desktop components in Edge | PASS: unchanged-refresh/remount draft retention, read failure/retry, activation isolation, Free write retirement/deletion, named confirmation and focus trap/Escape restore, empty-import validation/focus at 375/1280; test transport only |
| Web frontend TypeScript and check scripts | PASS: `tsc --noEmit` and all 17 check scripts, including 31 production client/auth deferred cases and 18 reset-controller behavior cases |
| Mounted web AuthProvider/client in Edge | 3 groups PASS: logout-cookie/login ordering, same-account late-profile retirement, and shared-cookie refresh identity rejection across two tabs; zero page errors/external page requests |

The selected native filters executed 27 unique tests, not the complete native inventory; large pre-existing `.dem` diagnostics were not run, read or parsed. The native executable was `D:/demo-manager/src-tauri/target/debug/deps/watchdemo_lib-0ceb6a46635617fa.exe`. The pinned future in `src-tauri/src/services/auth_subscription_test.rs` now ends its inner scope before explicit Arc/database cleanup. This fixes test compilation without changing the race, barriers or assertions.

Desktop note corrections now have primitive account/epoch dependencies, explicit read-error/retry states, memory drafts isolated by account/epoch/entity, named deletion confirmation and empty-selection feedback. Independent source review `e0c4fa18-eec9-45ff-9971-5b99d793a319` found no concrete P0/P1/P2 in that bounded slice. The coordinator additionally exercises the actual `NoteEditor`, `NoteDrafts` and `FeatureOwnership` implementations, not copies. The later isolated Edge run below additionally proves the listed mounted notes/import and focus cases. Neither the helper suite nor that browser fixture proves WebAudio lifetime, full Tauri IPC or the complete application.

### Closed implementation gaps and remaining operational gates

All three previously blocked implementation gaps are now closed through normal project tools after the user asked to continue; no security or auto-mode configuration was changed.

1. **Entitlement parity:** signed indefinite paid subscriptions are accepted only with the required paid anchor no later than issuance, a positive signed lifetime of at most 24 hours and the existing key/algorithm/issuer/audience/account/session/protocol checks. Present paid expiry still caps the permit; historical Basic expiry does not cap a newly signed Free identity lease. Native regressions pass. Independent review `a40dfdee-1aef-4b80-9fd2-40f83d6b47d1` found no issue in this bounded change.
2. **Web activation and credentials:** the actual AuthProvider uses semantic activation ownership distinct from credential rotation. Stale login/profile/refresh/logout results cannot replace or clear a newer activation. Pending/unknown non-idempotent reset barriers survive retirement. Cookie-mutating response phases are queued within one tab; this is not a global cross-tab lock. Refresh validates both subject and session against the captured credential before installation, except initial restoration without an old identity. A mismatch retires the owning UI without adopting or logging out the other session. Production-helper tests and the mounted two-tab browser case pass.
3. **Mock role parity:** only group reset opts into support-or-higher with strict target rules; unrelated mutation helpers retain their moderator default. Mock JWTs include the required access-token claim. Existing role/wiring check scripts pass; this is not a mounted staff-reset DOM proof.
4. **Logout and lock ordering:** expired access alone grants no cleanup authority. The logout-only fallback additionally requires a locked, active refresh session matching both captured subject and session, before refresh TTL/max lifetime. Valid bearer-only desktop logout remains supported; replacement cookies are not cleared or revoked. SQL ownership predicates precede `FOR UPDATE`, avoiding crossed-cookie lock inversion. The final 33 PostgreSQL tests include subsequent refresh refusal after revocation and a barrier-coordinated concurrent regression. Reviews `71f30c5c-f6cf-4baa-850e-5f47f1192f55` and `003f3a4a-7a41-43ec-9edc-4c38922074c1` confirm the source corrections; the latter found no further issue.

Remaining limits are explicit: full native Tauri/application, WebAudio lifetime, complete staff-reset DOM interaction and global cross-tab request serialization were not verified. Production signing private keys, compiled public pins and coordinated server/client update rollout remain operator-owned gates. Legal documents remain drafts; legal retention placeholders still require approval. Test keys and disposable databases are not production configuration.

Final sequential checks after the logout lock-order correction: PostgreSQL **33/33**, web TypeScript plus **17 check scripts / 49 client-reset behavior cases**, mounted web auth **3 groups**, cold service-first import, pure server **7/7** and Ed25519 **7/7** all passed. Legal catalog `--check` was current; AST parsing of the **128 web Python files**, `git diff --check` and empty indexes in both repositories passed. Fresh socket binds confirmed ports **55438/55439/55440** were released, and the last PostgreSQL cluster/runtime directories were absent. Repository HEADs remain `8f8509f` and `3821a58`.

The first new logout integration attempt failed before route execution because its test seed supplied timezone-aware data to the existing UTC-naive `created_at` column. Only the fixture conversion was corrected; no production timestamp schema or auth guard was relaxed. The coordinated concurrency case was then added and the full 33-test suite passed. Its negative wrong-algorithm fixture emits a short test-key warning; no production key was used. An initial two-tab browser assertion also treated the intended 401 rejection as unexpected; the corrected assertion requires that rejection and the anonymous/other-tab/cookie state before reporting success.

Earlier failed runs and classifier blocks below are historical, not successful checks. All changes remain local; no staging, commit, push, deployment, production request or effective legal release was performed.

## Historical first local integration continuation — 2026-11-05

`docs/scripts/run_postgres_subscription_checks.py` downloads pinned `@embedded-postgres/windows-x64@18.6.0-beta.19` (actual PostgreSQL 18.6), checks SHA-512 on the exact in-memory archive and extracts into a fresh private temporary runtime. It uses a fresh cluster with SCRAM-SHA-256 for both local/host authentication, listening only on `127.0.0.1:55438`, the fixture-allowlisted QA database and fake credentials. PostgreSQL's standard `pg_ctl` restricted Windows token is used, not elevation. The cluster and runtime are removed after shutdown, including test failures; the enclosing Job Object also terminates descendants. No existing user database or `.dem` content is accessed.

The first actual integration collection exposed a circular dependency: `APP.services.quota_service -> API.views.app.quota_schemas -> API routers -> APP.dependencies -> QuotaService`. The schema module moved byte-identically to `web/APP/quota_contract.py`, with all four callers migrated and no legacy shim or wire changes. The subsequent real integration run passed **20 tests**. The pure runner also has `--cold-import-check` to reproduce quota-service-first/API import independently of test collection order.

`docs/scripts/run_subscription_browser_checks.mjs` mounts the actual desktop NotesTab/ImportModal, actual auth/editor/dialog code and actual icon components with only test transport/control fixtures from `docs/browser-subscription/`. It uses the desktop Tailwind theme explicitly, no production proxy or dotenv files, a new Edge context and an allowlist that rejects every non-fixture HTTP origin. At both **375×800** and **1280×800**, actual DOM checks verified named confirmation, no early deletion, focus containment and Escape restoration, no horizontal overflow, and empty-selection feedback with focus on the fieldset. Draft retention, read retry, activation isolation and Free deletion also passed. Four screenshots and a bounded-scope result are under `docs/qa/subscription-browser/`; the coordinator inspected the 375px confirmation and 1280px import images. Browser/server cleanup completed, with no page errors or external page requests.

Initial browser attempts failed, not passed: the whole-repository watcher exhausted the 1 GiB budget. A metadata-only rerunnable census (`docs/scripts/probe_desktop_qa_scope.py`) found **240 source files versus 57,976 Rust build files / 8,509 build directories**. Disabling watchers/HMR for this immutable fixture reduced watched directories to zero; the successful run retained 1 GiB/one CPU and a 256 MiB Node heap. Initial Tailwind working-directory and test-label mistakes were also corrected before the passing run; no production UI fix was inferred from those harness errors. Vite reports two existing `state_referenced_locally` warnings in i18n initialization; no browser-page exception occurred.

Reproduce from the web repository (existing Poetry interpreter path is machine-specific):

```text
python docs/scripts/run_limited_check_windows.py --timeout 240 -- python -B docs/scripts/run_postgres_subscription_checks.py --python <Poetry-python.exe>
python docs/scripts/run_limited_check_windows.py --timeout 90 -- <Poetry-python.exe> -B docs/scripts/run_subscription_unit_checks.py --cold-import-check
python docs/scripts/run_limited_check_windows.py --timeout 180 -- node --max-old-space-size=256 docs/scripts/run_subscription_browser_checks.mjs
```

Independent source review `96320761-ab56-4a01-af34-3d4ca2a11892` found no issue in this focused integration change (OK with notes, not release approval). After that review, the final fresh-runtime PostgreSQL runner was actually rerun: **20/20 PASS**, followed sequentially by the cold import check, **7/7 pure tests** and the complete bounded browser fixture, all passing. The review's then-pending final-run limitation is therefore closed by execution, not by reviewer self-report.

Final housekeeping also passed: legal catalog `--check`, AST parsing of 134 Python files, `git diff --check` and empty indexes in both repositories. Fresh socket binds confirmed QA ports 55438/55439 were released; the last PostgreSQL cluster and extracted runtime directories no longer existed.

At this historical checkpoint these checks closed only the PostgreSQL and bounded notes/import browser gates. The later normal-tool continuation, 33-test PostgreSQL suite and web-auth browser results in the latest-state section supersede the three then-blocked implementation gaps. No check verifies production key pins, proves full WebAudio/native Tauri behavior or authorizes production rollout.

The web-auth browser fixture is reproducible separately:

```text
python docs/scripts/run_limited_check_windows.py --timeout 180 -- node --max-old-space-size=256 docs/scripts/run_web_auth_browser_checks.mjs
```

It mounts the actual React AuthProvider/client with fake loopback HTTP and real browser cookie processing. Its result under `docs/qa/subscription-browser/web-auth-result.json` covers two providers sharing cookies across tabs; it does not claim live backend/browser composition or global request serialization. Expired-access logout and persisted revocation are instead exercised against the actual backend and disposable PostgreSQL in `web/tests/test_auth_logout.py`.

## Safety boundary

Changes stay local in `watchdemo-web` and `D:/demo-manager`. No commits, pushes, deployment, production requests, production migrations or mail. Actual migrations are run only in freshly created QA PostgreSQL schemas after the user's explicit local-infrastructure authorization. Implementation agents read and edit only. The coordinator runs checks sequentially with process-tree resource limits. The coordinator resolved the existing Poetry lock through public package-index metadata, then installed the locked cryptography/cffi/pycparser binary wheels and pytest tooling into the existing local Poetry environment under containment. The later authorized integration run starts only a disposable local PostgreSQL cluster, an isolated Vite fixture server and a fresh headless Edge instance. These are stopped after checks; no production application service is started.

## Windows check containment

`docs/scripts/run_limited_check_windows.py` creates a suspended child, assigns it to a Windows Job Object, and only then resumes it. The job limits aggregate memory and restricts affinity to one logical CPU. Closing the job kills descendants. A named mutex prevents simultaneous limited checks. Less than 4 GiB free RAM, invalid configuration, or failed containment prevents launch. Docker, Podman and WSL workloads are refused because the process job cannot contain their external services.

Observed before checks: 21,084 MiB available physical memory, 32,680 MiB total, 12 logical processors.

Completed control checks:

| Check | Actual result |
|---|---|
| Child queries `IsProcessInJob` and its affinity | PASS: process in Job Object; CPU affinity has exactly one bit |
| 64 MiB job attempts 128 MiB Python allocation | PASS: allocation above job memory budget denied (`MemoryError`) |
| 2-second timeout with a sleeping child and descendant | PASS: limiter returned expected exit 124; a subsequent Windows process-handle probe found both recorded PIDs gone |

These checks prove containment behavior, not subscription correctness. The timeout probe covers forced cleanup of both the child and its descendant; it does not prove application behavior or arbitrary external service containment.

Example invocation from repository root:

```text
python docs/scripts/run_limited_check_windows.py --timeout 180 -- <executable> <arguments>
```

Default job memory is 1,024 MiB. No unrestricted fallback is available. A command exit, timeout or memory failure is a failed check, not a pass.

## Implementation checks

Historical initial handoff: backend implementation had finished while desktop Rust and web UI remained in progress; compilation and signing checks had not yet run. See the latest-state section for subsequent compilation/native/signing/PostgreSQL evidence and the bounded mounted-browser run; the older unrun statements below describe historical checkpoints.

The coordinator ran the fixture-only legal-generator suite with the Windows limiter (1,024 MiB, one logical CPU, 60-second timeout):

```text
python docs/scripts/run_limited_check_windows.py --timeout 60 -- python -m unittest discover -s docs/scripts/tests -p test_build_legal_catalog.py -v
Ran 14 tests
OK
```

All 14 passed, including exact hashes, draft/effective constraints, historical immutability, read-only checks and symlink rejection. These test temporary fixtures. After backend handoff the coordinator also regenerated all three repository outputs and ran `build_legal_catalog.py --check` under the limiter. Result: `legal catalog: up to date`. Catalog documents remain draft, with no effective release or sales activation.

Initial dependency probe of the default Python interpreter found no FastAPI, SQLAlchemy, pytest, cryptography or PyJWT. A later read-only search found an existing Poetry environment at `C:/Users/user999/AppData/Local/pypoetry/Cache/virtualenvs/watchdemo-web-A8o_2Vx7-py3.14/Scripts/python.exe`. A contained `importlib.util.find_spec` probe confirmed FastAPI, SQLAlchemy, PyJWT, Pydantic and asyncpg there, but not pytest or cryptography. No packages were installed. This may permit pure unittest/schema checks; Ed25519 signing and database integration remain separate verification gates. Do not silently install dependencies or report unrun checks as passed.

### Pure subscription behavior

The coordinator ran `docs/scripts/run_subscription_unit_checks.py` through the Windows limiter with the existing Poetry interpreter, a 90-second timeout, 1,024 MiB memory, and one CPU. All **5 tests passed** across `test_quota_periods` and `test_quota_protocol`: original-anchor calendar boundaries, shared boundary fixtures, strict DTO rejection of client authority/content, unknown-operation shapes, and in-process ASGI quota/validation error envelopes. HTTP logs for `http://test` are from ASGITransport, not external requests. Test settings bootstrap blocks dotenv reads and replaces service configuration with local fake values. The runner rejects application network connections.

The first attempt blocked every socket connection and produced one runner error because Windows implements asyncio's internal `socketpair()` via localhost. Four tests passed in that attempt. The reusable runner now permits only the synchronous standard-library socketpair handshake while rejecting application `connect` and `connect_ex`; the rerun passed all five. No production settings were read and no subscription code changed to accommodate the runner.

## Independent backend implementation review

Read-only review found no additional source-proven ledger/accounting defect, but returned a blocking verdict for two unresolved gates:

- The declared cryptography dependency initially lacked a lock entry. The coordinator resolved `web/poetry.lock` with Poetry 2.4.2 through the limiter, without installation. Added packages are cryptography 46.0.7, cffi 2.1.1, and pycparser 3.12. A contained check using Poetry's `Locker.is_fresh()` confirmed the content hash matches pyproject, and comparison with HEAD confirmed every previous package version was preserved. `poetry check --lock` still reports the pre-existing missing declared `web/README.md`; that command did not pass. The actual Docker dependency path uses `poetry install --compile --no-root`, but image installation was not executed. Lock resolution is complete; signing runtime and image validation remain unverified.
- The classifier blocked the worker's exact-expiry correction in `web/APP/entities/subscription.py`. Its existing `<` checks remain unchanged; quota authority uses the correct boundary. The coordinator reported the block to the user and has not retried it or attempted a workaround. A separate explicit authorization is required before retrying that action.

The coordinator added a behavioral pytest case for malformed PEM and an X25519 key supplied where Ed25519 is required in `web/tests/test_entitlement_service.py`. It is not run because pytest and cryptography are absent from the existing project environment. The pure unittest runner intentionally excludes this pytest suite rather than silently collecting zero signing tests. Read-only review and passing pure tests do not prove PostgreSQL concurrency, migrations, signing, or desktop recovery.

## Independent specification review

Read-only reviewer accepted the product scope and core staged-publication approach, and identified four items. The coordinator accepted and relayed all four to implementation owners:

1. Session/activation epoch must guard auth transitions and protected credential/cache updates, not only quota publication. Same-account relogin and A-to-B-to-A must reject stale refresh results.
2. Immutable reservation creation time is the metering timestamp for live reservations and committed usage. A commit after month rollover does not move the charge.
3. Updater adapter must distinguish true connectivity errors from metadata, policy, configuration and verification errors. Known mandatory updates stay blocking after download failure.
4. Status explicitly represents unknown operation IDs. Cancel-before-reserve stores a durable tombstone; delayed requests cannot resurrect cancelled operations.

Exact lease JWS claims, trusted-key configuration, feature IDs and error envelopes were frozen and sent to both owners. See the specification for the current contract.

A contained `ast.parse` pass accepted all 126 Python files under `web/`, without importing application modules. This is syntax validation, not execution of migrations or services.

## Web frontend handoff and checks

The web frontend worker completed its lane: tariff DTO/copy/fallback/account/pricing, support+ strict-target group reset UI, localized errors and checks. Under the limiter, `tsc --noEmit` passed and all 14 `src/**/*.check.ts` scripts passed. These include source assertions and pure helpers, not a real browser/reset request. Git's index was empty at this checkpoint. No browser, real API, production proxy, or payment flow was used.

After that pass, the coordinator added a local-only reset mock: per-target generation, zero inventory counts because mock libraries have no group inventory, reason validation and audit. A source inspection found its shared `target()` helper still enforces moderator. Auto mode blocked the follow-up edit making the minimum role parameterized with a moderator default and passing support solely for reset. Neither change in that blocked call ran, and no equivalent retry was attempted. Thus the current mock reset remains moderator-only, while the real server and UI specify support+. This known fail-closed mock mismatch needs owner action; do not claim support-reset runtime QA passed. All pre-existing mock moderator controls remain unchanged.

Read-only auto-mode inspection confirmed the denial layer is `classifier`, active mode remains enabled, and a broad hard-deny rule covers weakening authorization. Observability logging is disabled, so there is no decision log to inspect. No permission or auto-mode configuration was modified. A fresh contained `tsc --noEmit` after the added mock also passed. Independent source review completed with BLOCK: two P1 issues remain in reset request ownership across navigation and unsafe immediate replay after ambiguous failure; offline help also incorrectly implied Free existing-library access requires an unexpired lease. A bounded frontend corrective worker (`ebeebce1-1f09-41d1-aeee-c5e8c52499c5`) now owns this correction plus behavioral test source. The blocked mock-only support mismatch remains untouched. Actual browser/reset behavior and re-review are still pending.

## Continued protocol verification and early security review

After the first five-test pass, the coordinator added shared fixture shapes for a denied uncapped notes feature (`remaining: 0`) and an allowed unlimited Pro set-creation feature (`remaining: null`, metering boundary in `resets_at`). A test calls the real snapshot builder with a fake count repository and asserts exact wire output against both fixtures. The same contained, application-network-denied runner now passes **6/6** tests. This remains separate from PostgreSQL, cryptographic, Rust, and GUI validation.

An early read-only Rust security review found four P1 issues in the current implementation snapshot: an asynchronous high-water keyring write can resurrect a cache cleared by logout; access-token expiry during a request can mask a definitive 401 as a network failure; `/me` 5xx currently invalidates valid cached authorization; successful refresh-token rotation is lost if the subsequent `/me` call fails. The resumed sole Rust owner has the full report and corrective guidance. Corrections, tests, and re-review are pending; no release approval is implied.

## Web reset lifecycle integration block

The corrective frontend worker created `frontend/src/context/authSession.ts`, then auto mode blocked the minimal `frontend/src/context/AuthContext.tsx` lifecycle integration as outside its original bounded file list. The integration did not run. Parent approval is not a substitute for classifier/operator authorization; no alternate-file hook or retry is permitted. Same-account logout/relogin safety is therefore still a P1 gap, and the helper alone is not an integrated fix. The worker continues independent unknown-outcome recovery, route/request identity safeguards, tests, and offline help. Do not claim the full lifecycle issue resolved from partial changes.

## Additional auto-mode block

During the resumed Rust pass, auto mode blocked an `entitlement.rs` edit accepting the already-agreed paid lease with `subscription_expires_at: null` for existing indefinite subscriptions. The tool did not run; the same blocked call also bundled future-iat/highwater and fixture-timestamp edits, so none were applied. No retry, split-call retry, or equivalent workaround is authorized. The current verifier still rejects paid null-expiry leases, a fail-closed interoperability gap. The user was informed; specific authorization is pending. The intended invariant still requires a valid signed paid anchor, account/session/issuer/audience/key binding, and at most 24 hours offline, with subscription expiry additionally bounding the lease when present. Do not mark this branch verified.

## Paid-feature frontend handoff and current final validation boundary

Writer `f93c5207-3b00-4584-b50b-72ca1346b067` completed priority 4 in source: Plus voice loads/playback and late-await ownership/disposal, disabled/explained Free CS2 voice setting; Plus nonempty note edits/addition with explicit Free deletion and readable existing content; Pro playbook mutations/execution/metrics with Free saved-content/association read/delete. Explicit note Save replaces auto-edit/blur saves. Saved-query navigation now shows an honestly labeled local first-page preview instead of generic paginated navigation; ordinary/manual Basic search is unchanged. This navigation limitation is recorded, not claimed to preserve pagination.

Coordinator aligned Rust `src-tauri/src/ipc/manual.rs`: required nullable `query_summary` uses full-query `search_groups(filters,"total")` inside existing pre/post Pro and generation checks; no page-0 inferred winrate. Two DTO serialization regression sources added, **UNRUN**. Contained rustfmt parser PASS for that file only (not type-check). Expanded MAIN desktop harness: **17 behavior groups PASS**, including five feature-ownership/note-policy helpers; not real WebAudio disposal or mounted-component proof. Fresh Svelte check: **0 errors / 0 warnings**. Initial i18n check correctly failed a Cyrillic test-fixture literal; changed only its opaque retained localized name to German to keep the same language/context-change scenario. Rerun: **707 matching RU/EN keys, 76 files free of Cyrillic literals**, and all 17 groups PASS again.

A second compiler attempt kept the **same** 1024 MiB/one CPU/180s containment, only `CARGO_INCREMENTAL=0`: `cargo check --offline --locked -j 1` again failed exit 101 / rustc `0xc0000409, STATUS_STACK_BUFFER_OVERRUN`, exact `memory allocation of 9437200 bytes failed`. No compile PASS; no limit increase, no unrestricted fallback, no further compile retries. Only preceding source diagnostic remains unused `std::error::Error` in updater adapter. Native Rust tests remain unrun.

Read-only final paid-feature/DTO review `274fe677-dff5-46f4-9969-8975a7f6095f` completed: gates/aggregation are source-correct, but found a new **P1**: effects depend on the entire replaced `authStore.local` object via `activationBinding()`, so an unchanged access refresh resets NotesTab/MomentDetail drafts, closes PlaybookView forms/selection, and unnecessarily disposes/reloads voice. Required correction: stable primitive account/activation dependency, capture binding untracked, separate permission/completion checks; an early return inside the same broad-object effect does not prevent its previous cleanup. A **P2** remains: failed entity-note load leaves an endless loading state with no retry in NotesTab/MomentDetail; failure must be explicit and must not permit overwriting unknown contents.

Corrective worker `4899a69f-cd96-4868-9e82-863325fd8526` was **AUTO-MODE BLOCKED before its first edit** of `D:/demo-manager/src/lib/featureOwnership.ts`, with reason that D:/demo-manager was not explicitly authorized in its classifier context. No files changed or commands run; coordinator reported this despite the original user's express D:/demo-manager authorization. No retry, split edit, another-agent or parent workaround. Worker instructed to finish read-only handoff only. Both new findings remain **OPEN**, pending fresh ordinary human authorization. Browser verification of the correction is dependent and not claimed. Edge and playwright-core were located, but no browser harness/server/browser was started.

UX hard-rule pre-flight `7ac8344f-3c7a-47ac-85d9-dce94ebc3b95` completed read-only against all 19 canonical domain checklists. Source verdict **BLOCK**, no fixes applied:
- **F1/P1:** new note deletion in NotesTab (`deleteNote` -> `write("")`) and MomentDetail (`writeNote("")`) has neither a named destructive confirmation nor genuine Undo. Preserve Free deletion but require confirmation naming the target (and recheck activation/target after awaiting it), or real Undo.
- **F2/P1:** newly explicit-save note drafts are lost on ordinary Notes-tab unmount or MomentDetail Round/Demo scope changes. Retain drafts by actor/activation/entity/scope with an explicit Discard action and clear them on successful save/deletion/logout, or guard dirty navigation; never auto-publish on permission change. This is separate from the unchanged-access-refresh P1.
- **F3/P1:** note-read failure leaves permanent loading/no retry; duplicates the paid review's P2 finding, tracked once at the stricter source-review severity. Do not turn unknown contents into a writable successful load.
- **F4/P2/catalog:** ImportModal disables the primary action for editable empty selection. Keep operational pending/offline/ineligible locks and API validation, but an eligible editable submission should explain/focus `Select at least one demo` instead of using disabled state as invalid-input feedback. This is not a quota-enforcement bug.
Web reset named confirmation/reason/strict targeting/source ownership had no new UX defect; same-account-auth lifecycle remains the separately blocked P1. Existing desktop tokens take precedence; desktop profile missing, frontend `.ux-profile.md` applies to web with no marketing exceptions extended to admin. Dynamic focus, 375/1280 overflow/hit targets, animation/reduced motion, visual finish and screenshots remain **UNPROVEN**. Main located Edge after this source-only review; no browser was launched. No active desktop writer at this point. These new desktop corrections are also pending fresh human authorization; do not route around the prior block.

## Two additional Rust P1 corrections: source handoff and limited checks

Corrective writer `a03b56e5-01f0-4bfe-82c4-4d3c65988057` completed. Handoff: `D:/demo-manager/src-tauri/tests/subscription-p1-handoff.md`; premise/actor census: adjacent `subscription-p1-census.md`. Source now uses a transactional complete-batch denial disposition (`012_subscription_batch_denials.sql`) and token-activation rejection latch independent of offline capability generations. Four native regression sources/cases cover rollback/reopen/no subset publication, auth-apply versus mutation-serial barriers, delayed rejection versus real replacements, and refusal to reinstall a rejected cached grant. **All four Rust tests remain UNRUN.** Previously blocked verifier/timestamp changes remain untouched.

Coordinator contained checks:
- Updated isolated SQLite probe to apply the actual **12** migrations, with legacy fixtures inserted before migration 011. **5/5 PASS** under Python SQLite 3.50.4, including denial metadata's full-membership/disposition schema round-trip. This is NOT execution of Rust's transaction, fault injection, or recovery.
- `rustfmt --edition 2021 --config skip_children=true --emit stdout` parsed all nine modified Rust production/test files successfully under containment; output discarded, no formatting edits. **Syntax parsing only, not type-checking/compilation/test execution.** The prior Cargo OOM remains an unresolved gate.

Read-only corrective Rust review `8aad7b93-212c-4a50-a158-2a5f312f9c29` completed: both original P1 mechanisms addressed in inspected source; no additional concrete P0/P1/P2 or source-proven type/syntax failure in scope. Still BLOCK pending validation/existing gates. Test boundaries: denial recovery does not invoke ImportService::confirm; replacement cases seed replacement premises rather than exercising full login/apply_online; grant test uses unverified cache bytes, so Basic tier alone is not valid-paid-lease proof. Reviewer warning about including migration 012 was already satisfied by the coordinator's five-test rerun above. Main reconfirmed unchanged actual HEADs `8f8509f` / `3821a58` and empty indexes in both real repositories; source review did not establish an isolated corrective commit. Sole desktop writer is now frontend corrective pass `f5b099ca-918e-4d15-8614-a867b93a695b`; paid-feature UI pass follows sequentially. No concurrent Rust writer.

## Desktop frontend corrective handoff and remaining paid UI pass

Corrective writer `f5b099ca-918e-4d15-8614-a867b93a695b` completed all five accepted frontend findings in source. Extracted `lib/importController.ts` is the production state machine used by the Svelte wrapper, not a test-only model. Updated MAIN harness to transpile that module. Fresh contained run: **12 behavioral groups PASS** (original five plus actual controller quota-selection preservation, frozen retry, exact typed cancel recovery, no-selection auto-confirm, zero-allowance metadata, stale activation completion, and original creation-slot payload/ID recovery). Fresh Svelte check before starting next writer: **0 errors / 0 warnings**. Not browser/real-IPC proof. Corrective re-review `22a08a64-8a8f-4b91-b883-254590d2a9f8` completed: all five original findings fixed at inspected production seams; no new concrete P0/P1/P2. Verdict OK with notes **for that narrow corrective scope only**, not release approval. Tests execute the production controller/central slots but do not mount Svelte components or establish browser/Tauri races.

Paid UI supervisor decision: preserve existing full-query winrate, not infer it from first-page items or permanently remove it. Agreed `PlaybookExecution` DTO addition: required nullable `query_summary: GroupRow | null` (`key,label,count,won`), populated from full-query `search_groups(filters,"total")` behind the Pro execution seam. Without saved query both query fields null. Frontend writer may consume agreed field now; a subsequent sole Rust pass must add it before contract completion. Honest page-0 preview labeling required; generic Basic search remains free. Spec records this additive contract.

Sole desktop writer `f93c5207-3b00-4584-b50b-72ca1346b067` now implements only remaining priority 4: voice permission/loss/late-load cleanup and settings; paid note edits with Free read/delete; paid playbook create/edit/execute/metrics using existing `execute_playbook`, while preserving Free saved-content read/delete and generic search. No Rust/web/config/dependency changes authorized for that lane. Previously blocked changes remain untouched.

## Desktop frontend priority 1–3 handoff and actual checks

Desktop frontend writer `faaa8a8c-1783-4470-a474-5b188dba8e60` completed the bounded priority 1–3 pass: canonical DTO/auth activation, shared preflight/selection/confirm/cancel, stable creation-operation IDs, lazy first-mark set creation, account/offline/updater presentation and dynamic focus. It explicitly **did not complete paid voice/notes/playbook UI migration**; `execute_playbook` callsites remain to migrate. Creation retry slots are process-local, not restart-persistent. No Rust/web/dependency edits by that worker.

Coordinator sequential contained checks (1024 MiB/one CPU):
- `svelte-check --tsconfig ./tsconfig.json`: **0 errors, 0 warnings**.
- New `docs/scripts/run_desktop_subscription_checks.mjs D:/demo-manager`: **5 behavioral groups PASS**, executing the actual dependency-free production module and suite (strict DTOs, explicit subset validation, stable retry IDs/frozen payloads, activation change, definite denial). Uses existing TypeScript, temp output removed, network denied. Transpilation itself is not an additional type-check; Svelte check above provides diagnostics. Not browser/Tauri proof.
- `node scripts/check-i18n.mjs`: PASS, 695 matching RU/EN keys and 73 files free of Cyrillic literals.

Read-only priority 1–3 frontend review `4261ded0-b719-4984-b11f-3294f1157490` completed, verdict BLOCK. Accepted three P1s: cancel-response loss retries compare against impossible unprefixed text (actual IPC `WD-CORE-010` / `Invalid input: import plan not found`); Sidebar/AddToSetPopover/MatchReviewTab do not restore centrally retained uncertain payloads after remount/language/context changes; `quota_changed` clears every selected checkbox instead of preserving selection for user reduction. Accepted P2s: unnecessary confirmation even when `selection_required=false`, and zero-allowance dialog omits explanation/reset time. Need actual production-controller transition and remount regressions, not only pure helper tests. Reviewer confirmed all import origins converge, explicit confirmation IDs, lazy first mark, pending-sync messaging and account counters. Dynamic-focus/browser/real-IPC races remain unverified. Queue the corrective UI pass after the sole Rust writer finishes. Sole desktop corrective writer `a03b56e5-01f0-4bfe-82c4-4d3c65988057` is now fixing the two new Rust P1s (denial cleanup / definitive rejection latch); no concurrent frontend writer. Known blocked verifier/AuthContext/mock/entity changes remain untouched.

## Corrective frontend and isolated SQLite checks

The bounded frontend correction completed, with same-account relogin integration still explicitly blocked. A fresh contained `tsc --noEmit` passed. All **16** frontend check scripts passed, including **14 deferred-request behavioral cases** exercising the production reset controller's duplicate guard, A→B→A navigation ownership, stale completion, unknown-outcome barrier, fresh confirmation, definite refusals, consumed success, and malformed success. These are not browser/real-server proof and do not cover the disconnected auth-session seam. Focused independent re-review `5dcf00f8-2a39-48ce-9756-916b34e468ce` completed (source-only): route/unmount ownership fixed; ambiguous-outcome recovery fixed; paid-versus-Free offline wording fixed; no additional concrete findings in this corrective scope. Verdict remains BLOCK for known same-account auth-activation ownership and the mock support-role mismatch. The controller helper remains disconnected from AuthContext; passing tests do not establish that lifecycle.

Coordinator added `docs/scripts/check_desktop_subscription_migration.py`. Under containment, **4/4** tests passed against the actual eleven desktop migration SQL files, using Python SQLite **3.50.4** in `:memory:` only: existing demos/groups/sets preserved with no retroactive journal; deleted group ID tombstoned; pending set blocks demo deletion until publication; pending group name blocks conflicting rename. No user database or demo contents were opened. This checks SQL/triggers with Python SQLite, not Rust/sqlx migration registration, crash recovery, or the full desktop runtime.

## Rust handoff and contained compilation attempt

The resumed Rust worker completed a finite handoff. Frozen IPC and implementation details are recorded in its report; the desktop frontend worker `faaa8a8c-1783-4470-a474-5b188dba8e60` is integrating them, while independent reviewer `8c124850-905a-4ad1-a075-9dd7b65b9f00` reviews the stable Rust lane and the four claimed security corrections. No correction is accepted solely from worker self-report.

Coordinator ran `cargo check --offline --locked -j 1` from `D:/demo-manager/src-tauri` inside the 1024 MiB / one-CPU / 180-second job. It reached `Checking watchdemo v0.8.4` but failed with `memory allocation of 40960 bytes failed`, cargo exit 101, rustc exit `0xc0000409, STATUS_STACK_BUFFER_OVERRUN`. One diagnostic preceded termination: unused `std::error::Error` at `src-tauri/src/adapters/updater/tauri_updater.rs:50:9`. No source type error was established before memory termination. This is NOT a successful compile or a proven source-code regression. No unrestricted fallback or memory-limit increase was attempted. Full Rust compile/test gate remains open.

Both repository indexes were empty at their latest explicit inspections. The seven pre-existing untracked `D:/demo-manager/src-tauri/tests/fixtures/de_*.dem` files total approximately 2.4 GiB and were not read or parsed; the new small JSON fixture makes Git show the containing tests directory as untracked. Preserve those demos and all original user untracked files.

## Desktop recovery status

The first Rust worker hit its native 30-minute timeout without a usable handoff. Its partial diff and recovery artifacts were inspected. The same worker was resumed with retained context as run `7c91127f-3613-422b-b87d-d9067caf378c`; it remains sole owner of `D:/demo-manager/src-tauri/**`. No Windows compile or frontend implementation is claimed complete from the timed-out pass. Original run: `8211625c-2823-4e26-8ad2-0e2d03f32af6`.

## Remaining acceptance gates

- Cross-language DTO and error fixtures.
- Server quota concurrency, calendar, expiry, downgrade and idempotency behavior.
- SQLite staged publication and recovery before/after lost responses.
- Group reset generation, old library reconciliation and deletion tombstones.
- Signed lease tamper/account/session/clock/expiry tests and updater error classification.
- Import checkbox dialog, quota changed on another device, all import entrypoints.
- Paid data read/delete vs create/edit gates, voice and playbook execution paths.
- Web tariff copy, DTOs, error mirrors, staff reset confirmation/reason.
- Final local diff review and preservation of unrelated desktop files.
