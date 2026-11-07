# HTTP helper and service characterization

## Scope

`web/API/http/auth_cookies.py` owns the existing authentication cookie helpers.
`web/API/http/support_inputs.py` owns the existing support text and upload parsing.
The auth, user, public support, and internal support routes import these helpers
directly. The former private helpers and cross-router imports are removed.
Application services, public routes, response formats, and dependency locks do not
change in this extraction.

`web/tests/fixtures/http_helpers_before_w3.py` preserves the independent pre-change
helper implementations. `test_http_helpers.py` compares real Starlette response
headers and upload behavior against that reference. The contracts include cookie
flags, expiry, header order, deletion defaults, text trimming, MIME validation,
empty uploads, the size limit plus one byte, unread upload tails, errors, and
cancellation. The fixture fixes both Starlette's datetime and the standard
library's cookie clock. It does not change production time handling.

## Executed checks

The parent executed these checks serially on Windows, with one logical CPU and a
bounded Windows Job. No production database, provider, Telegram account, or mail
credential was used.

| Check | Result | Boundary |
|---|---|---|
| Full web test suite in one owned PostgreSQL 18.6 cluster | 264 passed, 1 skipped, 38 subtests | HTTP helper, auth, quota, support, legal, release, migration, and other collected backend contracts |
| Bot test suite | 28 passed | Fake Telegram and broker; real owned loopback aiohttp servers |
| Mail test suite | 175 passed | Fake provider and broker; schema, template, provider, and consumer contracts |

The crash symbolizer test is skipped because `CRASH_TEST_BUILD` and
`SYMBOLS__SYMBOLIZER` are absent. These results are not native desktop, browser,
real broker redelivery, deployed timezone, or external delivery acceptance.

The full PostgreSQL invocation uses `--full-suite` on
`docs/scripts/run_postgres_subscription_checks.py`. The original six-selector
invocation remains the default. Full mode runs migration history first, followed
by the remaining test files without duplicates. The disposable cluster uses UTC
to make its timestamp fixtures independent of the Windows host timezone.
Production timezone behavior is unchanged and was not verified outside UTC.

Two existing test infrastructure defects prevented the first full run. Windows
cannot put an oversized pytest parameter ID in its environment. Explicit short
IDs retain the original oversized request body and assertions. The legal
entrypoint subprocess also needed the test directory on its import path before
loading `conftest.py`. Readiness retries now include `ConnectTimeout` within the
same 15-second deadline and report the actual child stderr.

## Service test network boundary

`docs/scripts/run_service_contracts.py` is a Windows-only runner. Its repository
path is independent of the current directory and the developer's username. It
uses the selected service's existing isolated Python environment. Dotenv loading
is disabled before service collection, and sensitive settings are replaced with
fixture values.

The runner tracks ephemeral IPv4 loopback listeners created by the tests. Only
connections to those active listeners are allowed. It guards ordinary sockets,
DNS resolution, and `IocpProactor.connect`. The last guard matters because Windows
asyncio connections can bypass `socket.socket.connect`.

The bot's existing unreachable-endpoint test names `127.0.0.1:9`. The runner raises
`ConnectionRefusedError` at that boundary instead of contacting an unowned port.
The final run recorded four real owned loopback connections, two simulated
refusals, and no remaining listeners. Mail recorded no network connections or
remaining listeners. These guards constrain ordinary trusted tests. They are not
an operating-system sandbox against arbitrary native extensions or hostile code.

The service invocation is `python -I docs/scripts/run_service_contracts.py bot`
or the same command with `mail`, using the corresponding isolated interpreter
inside `run_limited_check_windows.py`. The executed limits were 2048 MiB,
one logical CPU, and 180 seconds per service. Dependency installation and changes
to runtime packages are not part of this runner.
