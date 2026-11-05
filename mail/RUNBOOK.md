# Service email / legal-revision notifications

## Scope and current status

Mail renders seven service types in Russian and English as subject + HTML + plain
text. The layout uses presentation tables, inline styles, an ink background and
blue action button, following `frontend/src/styles/tokens.css`. The logo exists at
`frontend/public/brand/logo-64.png`; its public URL is fixed in the template.
There are no operator/company particulars, promotional blocks, sales links or
Telegram-news invitations. EN legal notifications explicitly identify the linked
document as a Russian original. Existing accounts are not asked to accept again.

All shipped legal documents must remain drafts. Adding this consumer/template
must not activate documents or send a campaign. No real mail, provider calls,
network tests, broker, database or email-client rendering checks were run during
this recovery. D25 permits this lane only source inspection and editing.

## Configuration (operator must verify before real use)

`mail/config.py` reads nested environment variables, and currently also `.env`
and `../.env` relative to the working directory:

- `RABBITMQ__HOST`, `RABBITMQ__PORT` (default 5672), `RABBITMQ__USER`,
  `RABBITMQ__PASSWORD`, `RABBITMQ__VHOST` (default `/`).
- `RABBITMQ__EMAIL_QUEUE` (default `email`). The consumer must use the same name
  and vhost as the backend publisher.
- `RESEND__API`: a secret API key; never include in reports or logs.
- `RESEND__FROM_EMAIL`: explicitly configure the actual verified sender. The
  existing default `WatchDemo <noreply@watchdemo.io>` is NOT evidence of a verified
  sender/domain. Do not substitute invented operator details.

The lockfile pins Resend **2.29.0**. Legal sends pass a second `Emails.send`
argument, `SendOptions`, with
`{"idempotency_key": "legal-notice/<notification_id>"}`. There is no invented
tracking flag in the API payload. Before sending, an operator must inspect the
actual Resend domain/account dashboard and disable open/click tracking using
available provider controls, then verify that links are not rewritten and no
tracking pixel is injected. **Dashboard configuration is unverified and remains
a release blocker.** The template itself has no tracking pixel or tracking-query
parameters. Its public logo is still a remote image request, not a guarantee of
zero external requests by email clients. Mail-client handling of dark mode/images
and Outlook layout has not been visually tested.

## Actual caller inventory (read-only web audit)

All six legacy types are called by `web/APP/services/auth_service.py`:

| Type | Actual scenario | Data/link |
| --- | --- | --- |
| `verify_email` | Registration / verification resend | `verification_url`, `expires_in_hours`; `/verify-email?token=...` |
| `reset_password` | Password-reset request | `reset_url`, `expires_in_minutes`; `/reset-password?token=...` |
| `welcome` | Successful verification | `download_url`; `/download` |
| `email_change_confirm` | Requested new address | `confirm_url`, `expires_in_hours`; `/confirm-email-change?token=...` |
| `email_change_notice` | Notice to old address | `new_email`, `security_url`; `/account/security` |
| `password_changed` | Account password change | `security_url`; `/account/security` |

The backend `_frontend_url` provides the locale prefix. Mail does not invent a
new route or token. `legal_revision_updated` is the new backend outbox type;
backend must supply the effective revision's immutable URL, using `/en/legal/...`
for EN. Mail does not activate releases or implement account selection.

## Wire contract and rendering

Legacy jobs remain valid without `locale`, `notification_id`, or `created_at`;
unknown legacy locale falls back to Russian. The new type requires exactly:

- `type: legal_revision_updated`;
- `notification_id`: stable UUID allocated by backend outbox;
- `created_at`: original timezone-aware UTC ISO timestamp, not a regenerated
  publication/retry timestamp;
- `to_email`, `to_name`, `locale` (`ru` or `en`);
- `data`: exactly `document_title`, `document_revision`, `effective_date`
  (`YYYY-MM-DD`), `document_url`.

No IP, User-Agent, advertising or placeholder company details belong in the
payload. All interpolated HTML is escaped, including quoted URL attributes.
Links must be absolute HTTP(S), without credentials, literal whitespace,
control characters, backslashes or invalid ports. HTTP remains available for
isolated localhost previews; production caller origins should be HTTPS.
URL validation is not an origin allowlist and does not fetch the destination.
Plain text intentionally contains the original readable data and URL, not HTML
entities. Logs record only event/type/UUID/normalized locale/reason/attempts;
provider and broker exception representations are not logged by mail handlers.
Existing backend logging is outside this lane and still needs privacy review.

## Retry ownership and failure boundary

Only the new legal type uses this bounded policy; this is not a redesign of all
legacy mail flows. Code constants in `mail/consumer.py` are:

- `LEGAL_MAX_ATTEMPTS = 5`: at most five counted provider attempts on a normally
  acknowledged retry chain, including the initial attempt;
- `LEGAL_MAX_AGE = timedelta(hours=1)`: no new provider request starts once the
  original creation time is one hour old; equality is already expired;
- `LEGAL_RETRY_DELAY_MS = 60_000`: fixed retry delay of one minute;
- `x-mail-attempt`: completed/failed attempt count, initially absent/zero.

One hour is a conservative local retry deadline, **not** a claim that provider
idempotency lasts forever. The implementation contract records SDK option
support, not verification of a live account's retention policy. Resend's actual
current idempotency retention window must be confirmed by the operator to exceed
this one-hour deadline before enabling real notifications. Do not extend the
local deadline without rechecking the provider window and reviewing tests.
An in-flight provider call may finish after the deadline; no later retry is
started after expiry. Synchronize UTC clocks; future `created_at` values fail
closed rather than silently changing the timestamp.

With configured base queue `email`, the consumer declares:

1. `email`: durable, **no new arguments** on this already deployed queue.
2. `email.legal.retry`: durable **quorum** queue, `x-message-ttl=60000`,
   `x-dead-letter-exchange=""`, `x-dead-letter-routing-key=email`,
   `x-dead-letter-strategy=at-least-once`, `x-overflow=reject-publish`.
3. `email.legal.failed`: durable, no TTL/automatic replay.

Repository compose selects RabbitMQ 3.13. At-least-once dead lettering requires
broker support (including its `stream_queue` feature flag); operator must verify
this configuration and permissions before use. With the configured strategy,
the retry quorum queue retains ownership until its DLX publication is confirmed.
This was not exercised on a broker. Queue type/arguments are immutable: a
pre-existing conflicting retry queue must not be silently deleted/redeclared.
Investigate and migrate only with separately approved operator action.

Retries and terminal failures use persistent messages, `mandatory=True`, a
publisher-confirm channel and return exceptions. The original body (including
notification ID and creation timestamp) is copied byte-for-byte; headers are
preserved except the attempt/failure-reason values updated by mail. `message_id`
is the stable validated UUID, never a new UUID per retry. The original delivery
is acknowledged only after a confirmed durable retry/failed publication. If
publication fails, is returned, or is unconfirmed, the original is **not acked**;
ProcessContext requeues it (or broker recovers it on channel loss). An outage
can therefore redeliver repeatedly; this does not restart the age deadline.
A missing or lost confirmation can produce duplicate stored copies.

Transient/unknown provider errors increment the attempt count. Malformed legal
jobs are durably failed without provider calls. Invalid rendering/provider
value errors fail terminally. Exhaustion, future timestamps or deadline expiry
also go to the failed queue. Fixed reasons include `malformed`,
`future_created_at`, `provider_error`, `attempts_exhausted`,
`expired_outcome_unknown`, and `invalid_payload_or_provider_rejection`.
An unreadable JSON body cannot safely be identified as legal; existing poison
handling rejects it without requeue instead of assuming a notification type.

A crash after provider acceptance but before acknowledgement can cause a repeated
provider request. Broker redeliveries and lost confirms may exceed the normal
five-attempt chain because there is no transactional provider/broker ledger.
The stable key and the age deadline reduce this ambiguity **only within the
provider's finite window**. This is not exactly-once delivery. A successful SDK
response means submission, not delivery to the inbox. Backend outbox state is
only `pending`/`published`; no claim/finish API or `delivered` state is added.

## Failed-queue operation

Monitor failed queue depth and categorized mail events. Retain failed payloads
under restricted broker access: bodies contain recipient data and document
metadata. No retention period has been invented; approve an operational
retention/disposal policy before real notification activation. Infrastructure
loss beyond the broker's durability guarantees is not covered by this design.

Do not automatically drain the failed queue back to email, alter IDs/timestamps,
or repeatedly recreate jobs after expiry. Investigate by notification UUID and
backend outbox record. Check the provider's outcome privately; an expired or
unknown outcome needs an explicit operator decision. Replaying under a new key
may send a duplicate and is not an automatic repair. A one-hour expired pending
job can also fail without ever having reached the provider; investigate the
publication delay instead of claiming delivery.

## Parent-only validation handoff

Parent validation completed: **175 tests passed** using fake provider/broker and disposable configuration, under the enforced 1 GiB / one-CPU scope. Coverage includes:

- `mail/tests/test_templates.py`: seven types × RU/EN, HTML/text, escaping,
  unsafe URLs, localhost links, locale fallback, no welcome news promotion.
- `mail/tests/test_schemas.py`: required new envelope, UTC/UUID/date/URL
  validation, old-job compatibility.
- `mail/tests/test_email_service.py`: fake Resend only, both locales,
  stable second-argument SendOptions, legacy compatibility and sanitized logs.
- `mail/tests/test_consumer.py`: fake provider/broker, retry/expiry/exhaustion,
  durable failed publication, preserved metadata/headers, confirm failure and
  unchanged original queue arguments.

The parent ran tests from the persistent isolated mail worktree after checking
that both `.env` and `../.env` were absent from the test working directory.
Required Settings were supplied explicitly with fake RabbitMQ/Resend values;
all transport calls were fakes. No production `.env` was read. The previously
blocked `mail/tests/conftest.py` was neither created nor retried; these tests do
not depend on that file. Independent read-only review found no code blocker.

For subsequent runs, recheck the actual working directory and both env_file
paths before collection: consumer/provider modules import `config.settings`.
Do not run collection where that lookup reaches production credentials.
Template/schema tests do not import Settings. Parent alone may serially run
`<approved-python> -m pytest tests -q` from a verified isolated `mail/` directory
with explicit fake settings. Check available memory first; use the project's
`docs/scripts/run_limited_check.sh`, no parallel workers or simultaneous
infrastructure-heavy checks. The old `/tmp` environment is gone. See
`docs/LEGAL-verification.md` for the durable interpreter and actual results.
Do not send real mail or activate a release to test this lane. Broker behavior,
provider dashboard settings and real inbox delivery remain unverified; fake
tests do not establish those facts.
