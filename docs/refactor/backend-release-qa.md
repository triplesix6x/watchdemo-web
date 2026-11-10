# W2: release publication contracts and D18 reproducer

Status: **D18 reproduced and corrected; 57 combined PostgreSQL cases pass**. Baseline `e834aae4d7c7db2c5a6c242e34f461c101ed7bca`. The conditional D18 approval was triggered by the three precise committed-artifact failures below. Production changes are limited to private upload staging and publication ordering in `ReleaseService.publish`; dependencies, migrations, routes and historical evidence are unchanged. The initial four-file prerequisite and the final six-file correction each passed independent correctness/security and maintainability reviews without findings. These are static source/log reviews, not independent execution or hash verification. Registry/staging acceptance and the separate local commit remain parent-owned.

## Baseline source trace (before D18)

- `web/APP/services/release_service.py:150–173` validates trimmed SemVer, target/arch and nonempty trimmed signature, then performs a nonlocking duplicate lookup. An already committed duplicate is rejected before reading the installer.
- `web/APP/services/release_service.py:175–194` derives the sanitized final catalog path, writes the installer, then calls the real repository. Filename sanitization is at `web/APP/services/release_service.py:36–40`.
- `web/APP/services/release_service.py:197–227` opens that final path with `wb`, reads/writes chunks and checks the size limit. `except Exception` unlinks the final path and rethrows; empty input also unlinks. On supported Python, task cancellation is a `BaseException`, so it closes the file but bypasses this unlink handler. The service does not suppress these publication failures.
- `web/SPI/db_adapter/repositories/release_repo.py:46–57` performs the actual duplicate SELECT. `web/SPI/db_adapter/repositories/release_repo.py:105–145` inserts, flushes and refreshes after filesystem publication. `web/SPI/db_adapter/models/release.py:18–22` enforces `uq_releases_version_target_arch` independent of channel or filename.
- `web/API/views/admin/views.py:432–477` retains POST status 201, admin dependency, signature-file precedence, audit and response mapping. `web/API/views/app/views.py:17–76` retains updater 204/manifest and latest-download mapping. These routers are inspected, not imported or HTTP-tested by this module: importing their broad dependency graph is unnecessary for D18.

## Selectors and observed assertions

All selectors are in `web/tests/test_release_publication.py` (11 parametrized cases).

| Selector | Cases | Actual behavior and intended assertions |
| --- | --- | --- |
| `test_release_publish_metadata_urls_and_duplicate_rejection` | 1 | Real service, repository INSERT/flush/commit and fresh-session reread; exact normalized version, stable channel, filename/path, notes, flags, publisher, timezone, size, SHA256, signature and physical installer bytes. Explicit and frontend-fallback download URL. Actual `UpdateManifest` serialization and selected `LatestRelease` fields. Latest/update selection, equal/newer/invalid current-version rejection. Ordinary duplicate has exact 409/domain code/message/empty extras, zero stream reads and unchanged DB/file. |
| `test_release_validation_does_not_publish` | 6 | Invalid version, target, arch, empty signature, empty installer, over-limit installer. Exact 422/domain code/message/extras, stream-read count, no durable rows and no file except the catalog sentinel. The over-limit case crosses 1 MiB with a real second chunk. |
| `test_release_precommit_abort_rolls_back_metadata` | 1 | Real successful service flush followed by explicit exception before enclosing transaction commit; no durable metadata. Characterizes existing orphaned file bytes without demanding filesystem rollback. **Not a COMMIT failure simulation.** |
| `test_release_interleaved_loser_preserves_committed_winner` | 3 | Same version/platform/filename, different bytes; unique INSERT/flush failure, real stream-read exception after a write, and cancellation while awaiting the second read after a write. Requires independent PostgreSQL backend PIDs and transaction IDs, real absent-row reads and a committed winner before loser publication resumes. Final oracle requires unchanged durable winner metadata AND exact winner bytes; fixture sentinels must survive. |

The two publishers use separately scoped sessions and transactions. B starts first, pins its connection, performs the real duplicate SELECT and pauses immediately after its absent result, before final-path IO. A pins the other connection, really reads the absent row, publishes and commits. A's row and bytes are independently checked before B resumes. This models a request holding a stale precheck across another publisher's successful commit, not a fabricated repository result. Only B's instance method is wrapped; it always calls the original SELECT. No production publication algorithm is copied.

On the current source, the unique collision should be the actual PostgreSQL `duplicate key` error naming `uq_releases_version_target_arch`, during repository flush, not transaction COMMIT. Stream failure must be exactly `StreamFailure("test-only stream read failure after real file write")` on the second read; no arbitrary OSError is accepted. Cancellation is requested only after the second-read event proves the first chunk was returned to and written by the actual service. The cancelled task must be awaited and actually cancelled. A future ordinary `AlreadyExistsError` may reject the loser without being treated as corruption. If a future fix moves arbitration ahead of the cancellation read seam, adapt that schedule: a barrier timeout is never a meaningful red.

Observed precise D18 signatures in the clean baseline run:

- `unique_flush`: `D18 committed artifact overwritten by losing publisher`, after the exact unique-constraint failure and unchanged committed row are verified.
- `stream`: `D18 committed artifact deleted by failed publisher`, after the injected read failure is propagated and unchanged committed row is verified.
- `cancelled_stream`: `D18 committed artifact overwritten by losing publisher`, after actual cancellation/await and unchanged committed row are verified.

A timeout, import/settings/fixture/migration error, missing proof, unexpected exception, wrong constraint, same PID/transaction, absent committed winner or sentinel damage is **not** D18 confirmation. Do not xfail these invariants, assert current corruption as success, or report an absent-DB skip as acceptance.

## Correction and execution evidence

`publish` now writes the installer into an exclusively owned temporary directory under the final catalog directory. It performs the real unique repository INSERT/flush before atomically replacing the final path on the same filesystem. A losing INSERT, failed stream or cancelled upload removes only its own staged data; it cannot write or unlink the winner's final file. The public filename/path, metadata, error validation and `_store` algorithm are unchanged. A successful publication followed by an enclosing precommit abort still leaves the characterized orphan; this work does not add distributed DB/filesystem transaction semantics.

- Offline guarded collection: 65 tests, zero DNS/connection attempts, no DB capability; `C:/Temp/watchdemo-d18-offline-collection-bounded-ids.log`.
- The first baseline run exposed a Windows-only pytest automatic-ID problem for the synthetic oversized installer. Six explicit short parameter IDs fix only test metadata; inputs and assertions are unchanged.
- Clean baseline: 54 passed, 3 failed, zero fixture errors, 37.07 s. All failures match the three invariant messages above after the required connection/transaction/commit prerequisites; `C:/Temp/watchdemo-d18-postgres-meaningful-red.log`.
- After correction and the generic unexpected-catalog-file assertion: 57 passed, zero skipped, 38.37 s; `C:/Temp/watchdemo-d18-postgres-final-green.log`. The earlier green before that added assertion was 57 passed in 36.76 s, not the final artifact.
- Runs use the existing serial Windows Job, one CPU, 4096 MiB/300 s for PostgreSQL and 1024 MiB/90 s for collection. Each PostgreSQL 18.6 cluster was stopped and removed. The sole warning is the existing short fake SHA512 HMAC key. These times are not a performance comparison.

## Isolation, ownership and cleanup

- Any supplied nonempty `TEST_DATABASE_URL` is validated by stdlib `qa_safety.require_disposable_database` before this module's application/Alembic/SQLAlchemy imports, independently of the existing conftest guard. No URL means fixture-level integration skips only. No engine, migration or SQL occurs at collection.
- Existing conftest suppresses dotenv reads and supplies fixed fake settings. The fixture additionally requires the application URL to equal the authorized fixed URL. It revalidates the owned capability before schema SQL, migration, migration-engine creation, scenario-engine creation and teardown DROP. It never mints proof or starts a server.
- Each case owns `qa_release_<uuid hex>`, including its Alembic version table, through a schema-specific search path. CREATE/DROP identifiers contain only the fixed prefix and UUID hex. No public-schema reset or TRUNCATE is used. Migration engines and scenario engines are disposed; schema DROP is in `finally`, including migration failure. If proof disappears, DROP fails closed and the coordinator remains responsible for removing its cluster.
- Each case creates a fresh `TemporaryDirectory(prefix="watchdemo-release-qa-")` directly beneath the resolved OS temp directory, outside this checkout. It owns a marked root, a private `catalog` and an unrelated-file sentinel. Release settings are redirected before service import; public URL uses `.invalid`, upload cap is 1 MiB. Paths are never copied from environment or production assets. Marker/sentinel bytes are checked even when a scenario fails; the outer temporary-directory context removes all owned files.
- This follows the approved accidental-target threat model, not defense against intentional same-user path substitution. No app entrypoint, HTTP client/server, broker, Redis, mail, Telegram, production catalog or private data is used.
- Bounds: two connections, zero overflow, 5-second connect/pool waits, 3-second lock timeout, 5-second SQL timeout, 5-second events, 8-second loser await, 30-second scenario. Loser tasks are cancelled and awaited before engine disposal. The parent's whole-process Windows Job must bound migrations and cleanup as well.

## Parent-only integration and execution

The worker executed no commands below. After reading both new files, the parent added `web/tests/test_release_publication.py` to the existing PostgreSQL and guarded-collection selectors, retaining all five existing PostgreSQL selectors, proof issuance, fresh cluster, fake settings, cache suppression and finally-stop/removal. The parent executed the combined selection: all 57 cases pass as recorded above. The coordinator has no CLI selector override.

After that parent-owned integration, execute sequentially from this checkout through the existing one-CPU limiter:

```powershell
python docs/scripts/run_limited_check_windows.py --memory-mib 1024 --timeout 90 -- C:/Temp/watchdemo-refactor-python/web/Scripts/python.exe -I -B docs/scripts/run_guarded_web_collection.py
python docs/scripts/run_limited_check_windows.py --memory-mib 4096 --timeout 300 -- C:/Temp/watchdemo-refactor-python/web/Scripts/python.exe -B docs/scripts/run_postgres_subscription_checks.py --python C:/Temp/watchdemo-refactor-python/web/Scripts/python.exe
```

For a distinct red-only invocation, select `web/tests/test_release_publication.py::test_release_interleaved_loser_preserves_committed_winner` **inside the same owned coordinator child**, while its cluster and original proof are alive. For ordinary characterization select the module with `-k "not interleaved_loser"`. Do not use bare pytest with exported or reconstructed proof from an exited cluster. Preserve exact failures and prerequisite evidence; only the approved invariant assertion failures count toward D18 authorization.

Limitations: no real PostgreSQL COMMIT/connection-loss injection; no HTTP transport/status/permission enforcement test (domain status attributes only); no audit behavior, signature cryptographic validation, nginx serving, full channel/role matrix, activation/edit/list/changelog coverage, arbitrary filename matrix, cross-platform rename validation or malicious same-user races. The metadata schemas are real, but constructing them directly does not prove router wiring. This narrow workpack does not accept the whole release subsystem.
