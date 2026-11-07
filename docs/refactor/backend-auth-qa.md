# W2: bounded auth characterization and D17 reproduction

Status: **D17 reproduced; the minimal correction passes the bounded suite and both independent post-fix reviews.** The parent integrated the new tests into the existing guarded collection and disposable-PostgreSQL selectors. The original implementation produced three meaningful duplicate-consumption failures while 43 other cases passed. Under the user's conditional D17 approval, the parent then added active/unused predicates and the ordinary invalid-token error to the existing locking `mark_used` query. The unchanged tests now pass all 46 combined cases. No test is marked xfail or skipped to hide a failure. Settings, dependencies, migrations and historical evidence remain unchanged.

## Scope and source trace

The one-time token variants are `email_verification`, `password_reset` and `email_change`. Refresh tokens are a different mechanism, held by sessions rather than the one-time token table:

- `web/APP/services/auth_service.py:147–166`: `_active_token` hashes the supplied secret, asks `get_active` for a matching active/unused type, and checks expiry. Missing/used/wrong-type tokens raise `InvalidTokenError`, `token_invalid`, `Invalid or already used token`; expired matching tokens raise `TokenExpiredError`, `token_expired`, `Token expired`.
- `web/SPI/db_adapter/repositories/token_repo.py:28–40`: `get_active` executes a real nonlocking SELECT constrained by hash, type, `is_active` and NULL `used_at`.
- `web/SPI/db_adapter/repositories/token_repo.py:63–79`: the original `mark_used` locked by ID without rechecking consumption. The correction includes `is_active IS TRUE` and `used_at IS NULL` in that locking SELECT. PostgreSQL rechecks the predicate after a concurrent winner commits; no matching row raises the existing `InvalidTokenError`, `token_invalid`, `Invalid or already used token`. Service expiry timing and the method's return signature are unchanged.
- `web/APP/services/auth_service.py:394–410`: verification reads the token, marks it used, verifies the user, and attempts an optional welcome email before the caller commits.
- `web/APP/services/auth_service.py:444–454`: password reset validates the password, reads and consumes the token, updates the password and revokes sessions through the real `SessionRevoker`.
- `web/APP/services/auth_service.py:546–564`: email change also checks the active user, payload and target-address availability before consuming, updating the address, and invalidating password-reset links.
- `web/APP/services/auth_service.py:324–366`: refresh uses `SessionRepository.get_by_token_hash(..., for_update=True)`, rotates the session hash, and checks session/user lifetime and activity. That is not the D17 one-time-token read/mark sequence.

The user-row update locks do not repair the earlier authorization decision: the second caller can retain its already accepted token entity while waiting for the first caller to commit.

## Added executable contracts

All cases call the actual `AuthService`, token/user/session repositories and (for reset) `SessionRevoker` against migrated PostgreSQL. Only external email delivery and cache writes are local recording/failure sinks. No sink decides whether token consumption succeeds. Password validation, cost-12 hashing and verification remain real.

| Test in `web/tests/test_auth_token_concurrency.py` | Cases | Assertions |
| --- | --- | --- |
| `test_one_time_token_success_and_reuse` | Three token variants | Successful return is None; used timestamp set and active cleared; exact email/verified/password effects; reset revokes the seeded session in DB and cache; email change invalidates the sibling password-reset link; only verification sends welcome. A new transaction rejects reuse with exact exception class/message/code/empty extras and leaves the durable snapshot unchanged. |
| `test_one_time_token_expired_unknown_and_wrong_type_are_unchanged` | Three variants, each checking three inputs | One-hour-expired matching token, unknown raw token, and raw token presented to the wrong operation. Exact service errors; user, token, sibling and session snapshot unchanged; no mail/cache side effects. |
| `test_one_time_token_rollback_restores_consumption_and_user` | Three variants | Explicit injected failure after the real service completes but before the enclosing transaction commits restores all observed DB state. The same raw token succeeds in a new transaction. Precommit welcome/cache effects are recorded as existing behavior, not incorrectly asserted to roll back. |
| `test_verification_optional_delivery_failure_does_not_rollback` | Verification | External delivery exception is swallowed by the existing optional-email path, and the token/user transaction commits normally. |
| `test_one_time_token_two_connections_allow_only_one_consumer` | Three variants | Two different `pg_backend_pid()` values and two real successful active-token reads are prerequisites. Exactly one transaction must commit and the other must reject with the ordinary invalid/used-token service error. Durable winner state must satisfy the same normal-success oracle. |

Executed parametrized count: **13 cases** (10 ordinary characterization and 3 race regressions), all green after the correction. The three races were meaningfully red before it. HTTP status, response transport, cookies, JWT keys/claims, journals and audit records are not newly asserted here. No production semantics in those areas are changed or inferred from these service tests. Existing logout tests are retained; they do not establish complete refresh-cookie precedence coverage for this workpack.

### Deterministic two-connection schedule

`web/tests/test_auth_token_concurrency.py:251–305` creates two independently scoped async sessions/transactions with a two-connection pool. The test observes the actual `get_active` result without replacing it. A wrapper at `web/tests/test_auth_token_concurrency.py:265–271` pauses immediately before the real `mark_used` locking SELECT, then delegates unchanged to the original repository method. This boundary ensures that even email-change callers have both completed their real target-address precheck before either writes.

1. A and B pin separate PostgreSQL connections and record backend PIDs.
2. A reads the active, unused token and completes its service prechecks; A waits at the barrier.
3. B reads the same token and completes the same checks; both barrier waiters release.
4. One transaction acquires the actual token row lock, consumes the token, performs its real user/session effects and commits.
5. Before the correction, the second caller obtained the token lock and committed the operation again. With the active/unused locking predicate, it instead receives the ordinary invalid/used-token error, and its enclosing transaction rolls back.

Observed pre-fix failure: `D17 duplicate consumption: ['committed', 'committed']` at the exactly-one-commit assertion, after the different-PID and real-read assertions pass. A timeout, fixture error, migration error, unexpected domain exception or failed prerequisite is **not** confirmation of D17. The second verification is observable as a second service completion, even though the user boolean is idempotent. Reset and email change use the same bounded schedule independently.

This is a regression invariant, not a characterization accepting duplicate consumption. Do not weaken it, xfail it or report it green without execution. If a later approved fix moves row locking into `get_active` or combines the read/consume seam, this forced pre-mark barrier may need corresponding test-only adaptation: a timeout in a now-serialized precheck is not evidence that the fix is wrong.

## Fixture ownership and destructive boundaries

- Collection imports no app entrypoint, runs no migrations, constructs no engine and makes no connections. `web/tests/conftest.py` retains its existing pre-import guard/fake settings/dotenv suppression. This module additionally validates any explicit nonempty URL before its application imports.
- Absent `TEST_DATABASE_URL` uses the established opt-in integration skip, not evidence of passing. Any supplied invalid URL/capability must fail closed, not skip. Acceptance requires all 13 cases actually run against the parent-owned cluster.
- `auth_database` calls stdlib `qa_safety.require_disposable_database` before engine construction, schema creation, migration engine construction, scenario engine construction and teardown DROP. It also checks that the application settings URL equals that exact URL. Proof must identify the parent's fresh temporary loopback cluster, not merely a matching database name.
- Only the fixed W0 identity is authorized: `postgresql+asyncpg://watchdemo_qa:watchdemo_qa_local_only@127.0.0.1:55438/watchdemo_prelaunch_qa`, with matching `QA_DISPOSABLE_ROOT`, token, marker, data directory and ready PID proof. These are harness-only fake credentials. Do not mint capability for an existing/unowned server.
- Each case creates its own `qa_auth_token_<uuid hex>` schema. Alembic uses a schema-specific `search_path`; its usual connection URL is checked against the already authorized test URL. Every test engine uses that same private schema. No TRUNCATE, public-schema reset, real-user rows, files, mail, Redis, broker or Telegram calls are used.
- DROP SCHEMA CASCADE applies only to the locally generated identifier and is proof-checked again. If ownership proof disappears, teardown fails closed rather than dropping anything; the parent remains responsible for stopping/removing its entire owned cluster.
- The only monkeypatched production methods in the race test wrap and invoke original token repository methods. A separate test-only Alembic engine wrapper injects isolated search-path/timeouts without modifying runtime source.
- Scenario bounds: two pooled connections, zero overflow, 5-second connection/pool timeout, PostgreSQL 3-second lock and 5-second statement timeouts, 5-second barrier, 12-second contender group, 30-second scenario. Outstanding contender tasks are cancelled and awaited before engine disposal. Migration and whole-process termination remain enclosed by the parent's Windows Job timeout.

## Parent integration and executed checks

The parent appended `web/tests/test_auth_token_concurrency.py` to `docs/scripts/run_postgres_subscription_checks.py`, retaining the four previous selectors (historically 33 cases), `-p no:cacheprovider`, fake settings, capability issuance and cluster cleanup. It also added the module to `docs/scripts/run_guarded_web_collection.py`. Both integrations executed successfully. The combined PostgreSQL count is 46; the three races failed before the correction and pass after it.

After that reviewed integration, from this worktree, run sequentially through the parent limiter:

```powershell
python docs/scripts/run_limited_check_windows.py --memory-mib 4096 --timeout 300 -- C:/Temp/watchdemo-refactor-python/web/Scripts/python.exe -B docs/scripts/run_postgres_subscription_checks.py --python C:/Temp/watchdemo-refactor-python/web/Scripts/python.exe
```

For a separate bounded red-only invocation, the parent may select `web/tests/test_auth_token_concurrency.py::test_one_time_token_two_connections_allow_only_one_consumer` inside the same harness-owned child pytest invocation, while the same owned PostgreSQL and proof are alive. For characterization only, use this module with `-k "not two_connections"` in a distinct invocation, explicitly reporting that the race was not run. Do not export capability from an exited harness or use a bare pytest command with arbitrary DB settings.

Execution evidence (serial Windows Jobs, one logical CPU):

- Pre-execution independent correctness/security and quality reviews passed the four-file test/integration scope; neither reviewer executed tests or independently recomputed hashes.
- `C:/Temp/watchdemo-w2-auth-offline-collection.log`: 54 cases collected in 0.97 s with no DB capability and zero DNS/connection attempts; collection Job 1024 MiB, 90 s.
- `C:/Temp/watchdemo-w2-auth-postgres-red.log`: PostgreSQL 18.6, 43 passed and exactly three failed in 32.74 s. Each failure was `D17 duplicate consumption: ['committed', 'committed']`, after distinct-PID and successful-read prerequisites passed.
- `C:/Temp/watchdemo-w2-auth-postgres-green.log`: the unchanged combined suite passed all 46 cases in 31.37 s after the minimal repository correction; no skips. Both PostgreSQL Jobs used 4096 MiB and a 300 s timeout. Each server stopped and its owned temporary cluster was removed.
- Both database runs retain the existing fake-key SHA512 length warning; no production key was changed. These timings are execution records, not a performance comparison.

Independent post-fix correctness/security and quality reviews both passed the six-file correction/test/evidence scope with no findings. They inspected the logs but performed no execution or independent SHA recomputation. The separate registry addition records only this tested infrastructure module; it does not accept the whole token repository or auth subsystem. The parent validated the isolated seven-file acceptance tree: registry completeness passed with 412 sources / 402 pending, and all five inventory self-tests passed (1024 MiB, one CPU, 60 s per Job). Staged scope/hashes must still match that artifact; unrelated W1/visual work remains outside this commit.

Not covered: required mail-publication rollback for issuing new links; actual commit/connection loss; cache failure/reconciliation; full password/lockout policy; refresh races/credential precedence; all HTTP/API/auth gates; expiry exactly at the clock boundary; other-token invalidation races; module-wide journal/redaction guarantees; any claim of full backend acceptance. The injected precommit abort is not a simulated PostgreSQL commit failure. No runtime commands, tests, PostgreSQL processes, servers, browsers, installs, commits or staging operations were performed by this worker.
