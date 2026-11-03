# Backend legal prelaunch operations

Implementation status: authored, **not runtime-validated**. The implementation agent
ran no tests, migrations, servers, builds, installations, Docker, or network checks
(D25). The coordinator owns sequential resource-limited validation and deployment.
All shipped catalog documents must remain draft (sequence 0, no signoff/retention).

## Configuration and ordering

- `APP__FRONTEND_URL` must be a single HTTP(S) origin, without credentials, path,
  query, or fragment. Manifest URL is exactly `/legal/catalog-manifest.json` there.
- `APP__LEGAL_MANIFEST_TIMEOUT_SECONDS` defaults to 3 seconds, maximum 10. Readiness
  caps responses at 1 MiB, disables environment proxies and refuses all redirects.
  Only effective activation performs this request. Tests inject fakes explicitly.
- Apply migration `0005_legal_prelaunch` after `0004_support` before starting this
  backend version. The migration creates four tables and immutable/retention SQL
  triggers; it has not been executed by the implementation agent.
- Publish immutable frontend revision pages and matching manifest **first**, then
  release the backend bundle. Retain old revision URLs. Manifest equality is a
  bounded readiness signal, not proof about every CDN replica.
- Startup schedules an immediate reconciliation pass and subsequent passes use the
  existing support periodic interval (default 300 seconds). Every worker is safe
  to run it: activation takes an exclusive transaction advisory lock; signup/read
  takes the corresponding shared lock. A newer unactivated effective bundle
  returns 503 for signup/policy instead of silently accepting old/draft terms.
  Older bundles use the highest DB policy and never downgrade it. Login/reset and
  existing desktop access do not consult signup policy.

## Proxy/IP boundary

`APP__TRUSTED_PROXY_ADDRESSES` is a JSON array of actual IP addresses or CIDRs,
for example `["172.20.0.4"]` for a separately verified reverse-proxy address.
Default `[]` trusts no forwarded headers. Wildcards and hostnames are rejected.
Do not configure a broad network containing untrusted clients. The proxy must
strip/rebuild client-supplied forwarding headers before forwarding requests.

The ASGI server's own proxy-header parsing must be disabled so it cannot rewrite
`scope.client` before the application applies this configured trust list. For a
Uvicorn entrypoint, use `proxy_headers=False` / `--no-proxy-headers`; confirm the
actual FastAPI CLI supports the chosen spelling before updating its deployment
command. Root compose/entrypoint is coordinator-owned and was not edited here.
An outer parser's already rewritten client IP cannot be repaired by inner app
middleware. Validate the deployment path as well as middleware-only tests.

## Registration and errors

`GET /api/v1/legal/signup-policy` is `Cache-Control: no-store`. Draft signup stays
compatible without `legal_acceptance`; any purported acceptance of a draft is
422. Enforced signup requires only the current terms acceptance. Missing/false is
422, stale policy/revision/hash is 409. Legal errors reuse `validation_failed`
with `reason`: `legal_draft_acceptance`, `legal_acceptance_required`,
`legal_policy_stale`, or `legal_policy_unavailable` (503).

Account, Basic subscription, append-only evidence and verification token commit
in one transaction before publishing the verification email. Evidence contains
server UTC time, account ID, immutable terms hash/revision, action, locale,
canonical client IP and at most 512 User-Agent characters. If post-commit email
publication fails, the created account is retained; the existing resend flow is
the recovery path. No verification-email outbox was introduced in this scope.

Evidence has no account-delete cascade. SQL blocks updates and deletion before
its approved finite retention deadline. Periodic purges expired evidence using
DB time. Published snapshots/activations cannot be updated or deleted. There is
no legal-editor UI or acceptance backfill.

## Legal notification outbox

Activation, cutoff and pending rows commit atomically. Eligible recipients are
active, verified users created no later than cutoff. The DB uniqueness key is
`(user_id, document_id, revision)`; concurrent workers/restarts/draft edits do not
create duplicate logical jobs. Recipients are rechecked with a user row lock;
absent/deactivated/unverified users become `suppressed` before MQ publication.

The publisher locks pending jobs with `FOR UPDATE SKIP LOCKED`, uses mandatory
persistent MQ messages and broker confirms, then marks them `published`. This is
**not delivered/sent**. A failure retains pending rows. If broker acceptance is
followed by uncertain DB commit, the job may be republished with the exact same
`notification_id` and `created_at`. Provider idempotency/retry-window handling is
owned by mail; there is no exactly-once or indefinite dedupe guarantee. Review
pending/published/suppressed counts separately from mail's failed queue. No
production activation, network readiness probe or real email was performed.

Email logs omit recipient addresses and token URLs. Auth publication failures log
only message type, internal user ID and exception class; required failures expose
a generic exception with the sensitive original chain suppressed. Legal outbox
failure logs likewise omit raw exception messages/tracebacks. This changes no
email retry or account transaction behavior.

## Coordinator-only validation

Use the existing `docs/scripts/run_limited_check.sh` from main, one check at a time
with effective CPU/memory limits. No old `/tmp` environment or QA DB is assumed.
DB tests opt in with `TEST_DATABASE_URL` and legal tests reject anything other
than `postgresql+asyncpg://watchdemo_qa:watchdemo_qa_local_only@127.0.0.1:55438/watchdemo_prelaunch_qa`
(`localhost` is also permitted). They truncate this disposable schema only.

`tests/conftest.py` replaces inherited configuration with local/fake values and
blocks dotenv file reads while importing settings. For **coordinator-run**
Alembic checks, preload the same test-only settings in the same Python process,
e.g. from `web/`: `python -c 'import runpy; runpy.run_path("tests/conftest.py"); from alembic.config import CommandLine; CommandLine().main(argv=["upgrade", "head"])'`.
Use that same settings bootstrap for downgrade to `0004_support` and upgrade
again; do not use plain Alembic that would read root `.env`. No migration command
in this document has been run by the implementation agent.

Review/run `tests/test_legal_catalog.py`, `tests/test_legal_service.py`,
`tests/test_legal_transport.py`, and affected existing backend tests. Then verify
migrations up/down/up and real server proxy configuration under isolated QA.
Generated artifact freshness remains the catalog lane/coordinator check.

Tier API is the D13 **public metadata** matrix (0/349/469 RUB, sales closed).
`custom_sets.limit` is per demo; demo import uses `monthly_limit` plus
`limit_period`. Actual Windows quota enforcement is explicitly not implemented.
