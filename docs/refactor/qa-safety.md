# W0: QA safety boundaries

Status: integrated safety infrastructure. Parent-run helper, quota/protocol, disposable PostgreSQL and guarded collection checks passed; exact scope and limits are recorded in `verification.md`. Initial independent reviews found no code defects and one documentation inconsistency, corrected here. Broader browser and crash/support HTTP acceptance remains pending. No production API, settings, Compose, UI, dependencies or historical evidence is changed. D17/D18 remain separate workpacks.

## Disposable PostgreSQL authorization

`web/tests/qa_safety.py` is stdlib-only. `web/tests/conftest.py` validates any nonempty `TEST_DATABASE_URL` before application/settings imports. Support revalidates before engine construction/TRUNCATE. Crash collection no longer opens a probe socket; its client validates before importing/running Alembic, verifies the actual application DB settings, and revalidates before SQL. An absent URL skips integration cases, not pure cases. An invalid explicit URL fails collection rather than silently skipping it.

The sole accepted URL is exactly:

```text
postgresql+asyncpg://watchdemo_qa:watchdemo_qa_local_only@127.0.0.1:55438/watchdemo_prelaunch_qa
```

A matching name or loopback address is insufficient. Authorization also requires:

- `QA_DISPOSABLE_ROOT`: absolute, fresh direct child of Python's resolved `tempfile.gettempdir()`, named with the existing `watchdemo-pg-qa-` prefix;
- `QA_DISPOSABLE_TOKEN`: 64 lowercase hex characters generated per run;
- non-symlink root/data/marker/PID proof, matching marker contents, and local `data/postmaster.pid` matching the data directory, positive PID, port `55438`, listen address `127.0.0.1` and `ready` status.

The marker is an accidental-target prevention capability, not protection against a malicious process with the same OS user. The parent must own and retain the cluster for the entire child execution; do not mint a marker for an existing/unowned server. No network is used to validate proof. Missing, stale or tampered proof fails closed.

### Implemented authorization in `docs/scripts/run_postgres_subscription_checks.py`

The harness now performs the following before invoking its existing pytest suites:

1. Remove inherited `QA_DISPOSABLE_ROOT` and `QA_DISPOSABLE_TOKEN` along with `TEST_DATABASE_URL` from its child environment.
2. Preserve the existing free-port check, fresh `TemporaryDirectory(prefix="watchdemo-pg-qa-")`, initdb, password authentication, loopback-only startup and readiness check. Use `root = Path(directory).resolve()` so proof uses the canonical path.
3. After startup/readiness and creation of the test database, generate `token = secrets.token_hex(32)`. Write `root / "qa-disposable.json"` with `json.dumps({"token": token, "database_url": env["TEST_DATABASE_URL"], "data_directory": str(root / "data")})`, UTF-8. The URL must be assigned before writing the marker. Add stdlib `json` and `secrets` imports.
4. Set `QA_DISPOSABLE_ROOT=str(root)` and `QA_DISPOSABLE_TOKEN=token` only in the child environment. Do not print the capability. Run tests while that same cluster is alive. Existing immediate-stop/finally/temp-directory cleanup remains mandatory.
5. Keep existing suites; only after negative gates pass add support/crash to a separately bounded integration invocation. Crash migrates in its fixture, never at collection. Existing Alembic/application settings must remain the fixed fake conftest identity above. Do not point production settings at the test URL.

The integrated harness passed 33 tests against its own PostgreSQL 18.6 cluster, then stopped the server and removed temporary storage. This verifies the selected existing suites, not the full crash/support HTTP suite. Do not replace the fixed fake identity or issue capability for an existing server.

## Browser modes and network boundary

There are no implicit defaults. `qaTarget` accepts only these exact pairs:

| `QA_MODE` | Exact origin | Intended server |
| --- | --- | --- |
| `mock-browser` | `http://127.0.0.1:4400` | `frontend/scripts/serve.mjs` serving an explicitly built mock dist, no API proxy |
| `isolated-backend` | `http://127.0.0.1:55440` | Parent-owned temporary app/services, fake mail/broker sink and disposable storage/DB |

Local-app requires `isolated-backend` and reads `QA_ORIGIN`. Ghost reads `QA_ORIGIN`; Focus site reads `FOCUS_SITE_URL`; both require `QA_MODE`. No regular Vite server or production proxy is an approved target. The fixed port is an allowlist, not proof that the process listening there is isolated: the parent must start and own the declared server. Existing `172.*`, localhost, default Vite `5173`, Ghost `4540`, arbitrary loopback ports, credentials, alternate schemes, origin paths (including trailing `/`), query and fragment are rejected before browser launch/page/context requests.

Every covered browser context blocks service workers and installs HTTP and WebSocket guards before creating its first page. WebSockets are disabled. HTTP routes validate the exact origin before `route.fetch`; mock mode rejects API paths before the server can proxy them. This is a safety rejection, not a fake API response: mock UI must use its in-bundle fixtures. No data/blob network exceptions are granted.

`context.request` bypasses browser routes. Local-app now uses the explicit `guardedRequest` wrapper for every request; it validates before invocation and forcibly sets `maxRedirects: 0` after caller options. Browser routing also fetches with zero redirects and refuses to fulfill redirect responses. **All HTTP redirects, including same-origin redirects, fail closed.** This avoids Playwright's redirected-request routing bypass; no redirect target receives a request. Parent integration must use canonical URLs and may not loosen this guard to make a test pass. Other new direct `context.request` uses must use the wrapper.

The guards control runner-originated browser/HTTP traffic, not OS-wide egress or backend delivery. Fake delivery adapters and process/resource containment remain parent responsibilities. Desktop/mobile harness origin logic is unchanged; only their artifact destinations are changed in this package.

## Static path containment

`qa-static-path.mjs` decodes the raw request path before URL normalization, rejects malformed escapes, NUL and backslashes, then uses `path.relative` containment rather than string-prefix comparison. `serve.mjs` also resolves file symlinks before serving and refuses resolved escapes. Encoded traversal into sibling `dist-backup` cannot expose files. Malformed paths return 400, root escapes 403, absent fallback documents 404. No API proxy is introduced.

## Output isolation

Desktop access, mobile replay, local-app, Focus and Ghost require absolute `QA_OUTPUT_DIR`. Its parent must already exist. The selected directory must be outside this worktree (checked against canonical parent/repository paths), must not already exist, and is created without recursive reuse. Desktop access additionally protects its desktop dependency repository. Every run gets its own directory. Existing files, symlinks and historical QA directories cannot be selected. No old PNG/JSON/report is edited. The old Focus/Ghost default directories and `FOCUS_SITE_OUTPUT` no longer select the output.

PowerShell setup for a later parent-owned run, not authorization to start a server here:

```powershell
$env:QA_OUTPUT_DIR = 'C:/Temp/watchdemo-qa-desktop-UNIQUE'
# Choose a different nonexistent directory for every runner.
$env:QA_MODE = 'mock-browser'
$env:FOCUS_SITE_URL = 'http://127.0.0.1:4400'
$env:QA_ORIGIN = 'http://127.0.0.1:4400'
```

For local-app the parent must explicitly change both mode to `isolated-backend` and origin to `http://127.0.0.1:55440`, after owning/isolating that stack. This package does not alter production Compose or start services.

## Parent validation commands

Run sequentially from the repository root through the existing Windows Job limiter (one CPU). These helper checks do not start browsers, servers, databases, installs or network work. Python uses only stdlib. The Node adoption test imports the existing Playwright SDK and legacy runners (including Focus's axe-core dependency), but replaces browser launch with a failure sentinel and forbids writes outside its owned temporary output:

```powershell
python docs/scripts/run_limited_check_windows.py --memory-mib 1024 --timeout 60 -- C:/Temp/watchdemo-refactor-python/web/Scripts/python.exe -B web/tests/test_qa_safety.py
python docs/scripts/run_limited_check_windows.py --memory-mib 1024 --timeout 60 -- node --max-old-space-size=256 --test frontend/scripts/qa-safety.test.mjs
```

Python rejects absent/foreign URLs, missing proof, token/data/port/listen/readiness tampering with zero connect calls. It also accepts syntactically valid owned-cluster proof without a connection. Node rejects hostile origins before request setup, rejects browser/API request escapes with zero fetch calls, forces zero redirect following, rejects mock API proxy calls, malformed/static traversal, historical output paths and output reuse. No browser is launched by these tests; SDK import is not browser execution. Temporary fixtures are removed in cleanup.

After the helper checks, independently prove crash/support collection is offline in the existing isolated web environment. The maintained collector clears DB capability, suppresses dotenv, disables third-party pytest autoload/cache, blocks outgoing connects and DNS, and counts attempted calls even if application code catches their errors. Only the stdlib Windows socketpair handshake is exempt. No test bodies execute:

```powershell
python docs/scripts/run_limited_check_windows.py --memory-mib 1024 --timeout 90 -- C:/Temp/watchdemo-refactor-python/web/Scripts/python.exe -I -B docs/scripts/run_guarded_web_collection.py
```

The repository collector collected 41 tests with no connection or DNS attempts. It replaces the earlier inline experiment; do not substitute a weaker connect-only patch.

Remaining gates: final scoped review follow-up, full crash/support HTTP integration, bounded mock and isolated-backend browser checks (including redirects/service workers/WebSockets), live malformed-URI/traversal server responses, and distinct external output runs with historical-artifact preservation. Helper-level tests, collection and the selected PostgreSQL suites do not claim these broader integrations passed.
