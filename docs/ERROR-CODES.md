# API error codes

Every error response from `web/` has this JSON body:

```json
{"message": "English text for logs", "code": "snake_case_code", "...": "extra fields"}
```

- `code` is stable. The site localizes by `code`. `message` is English, may change, and is never shown to users.
- Extra fields appear only when they have a value.
- `429` responses with `retry_after_seconds` also send a `Retry-After` header.
- `422` from request-schema validation keeps FastAPI's `detail` array: `{message, code: "validation_failed", detail: [{loc, msg, type, ctx}]}`.
- `429` from the per-IP rate limiter keeps `detail` (the same text as `message`) for older clients.
- HTTP statuses did not change in this pass. The desktop app reads only statuses.

The source of truth is `ErrorCode` in `web/APP/exceptions.py`. A test fails when this table and the enum drift apart.

| code | status | where raised | extra fields |
|---|---|---|---|
| `invalid_credentials` | 401 | `POST /auth/login`: wrong login or password | `attempts_remaining` |
| `too_many_attempts` | 429 | `POST /auth/login`: login locked after 5 failures | `retry_after_seconds` |
| `email_not_verified` | 403 | `POST /auth/login` | |
| `account_deactivated` | 403 | `POST /auth/login`, `POST /auth/refresh`, any authenticated endpoint when the caller's account is off | |
| `invalid_password` | 403 | `POST /users/me/password` (`current_password`), `POST /users/me/email`, `DELETE /users/me` | |
| `password_weak` | 422 | `POST /auth/register`, `POST /auth/reset-password`, `POST /users/me/password` | `rule`: `min_length`, `uppercase` or `digit`; `min_length` (10) when `rule` is `min_length` |
| `email_taken` | 409 | `POST /auth/register`, `POST /users/me/email`, `GET /auth/confirm-email-change` | |
| `username_taken` | 409 | `POST /auth/register`, `PATCH /users/me` | |
| `email_unchanged` | 422 | `POST /users/me/email`: new address equals the current one | |
| `username_mismatch` | 422 | `DELETE /users/me`: typed username differs | |
| `user_not_found` | 404 | admin user endpoints, subscription grant/extend/revoke, `POST /admin/users/role`, `GET /users/me` | |
| `session_not_found` | 404 | `DELETE /users/me/sessions/{id}` | |
| `token_missing` | 401 | any authenticated endpoint without `Authorization`; `POST /auth/refresh` without a cookie or body token | |
| `token_invalid` | 401 | bad or malformed access token; unknown or revoked refresh token; unknown or used one-time link (`verify-email`, `reset-password`, `confirm-email-change`) | |
| `token_expired` | 401 | expired access token, refresh token, session past its maximum age, or expired one-time link | |
| `session_revoked` | 401 | any authenticated endpoint after the session was ended | |
| `insufficient_role` | 403 | admin endpoints when the caller's role is too low | |
| `cannot_target_self` | 403 | admin actions on yourself: activate/deactivate, end sessions, password reset, subscription grant/extend/revoke | |
| `target_role_too_high` | 403 | admin actions on an equal or higher role (only an admin may act on an equal role); beta flag and manual verify reject only a higher role | |
| `target_deactivated` | 403 | `POST /admin/users/{id}/password-reset` on a deactivated account | |
| `subscription_not_found` | 404 | `POST /admin/subscriptions/extend` | |
| `tier_has_no_expiry` | 422 | `POST /admin/subscriptions/extend` on Basic | |
| `subscription_no_expiry` | 422 | `POST /admin/subscriptions/extend` on a paid tier without an end date | |
| `release_not_found` | 404 | `GET /app/latest` (no build), `PATCH /admin/releases/{id}`, `PATCH /admin/releases/{id}/active` | |
| `release_duplicate` | 409 | `POST /admin/releases`: version already published for that platform | |
| `release_bad_version` | 422 | `POST /admin/releases`: not semver | |
| `release_bad_platform` | 422 | `POST /admin/releases`: unknown target/arch | |
| `release_bad_signature` | 422 | `POST /admin/releases`: empty signature | |
| `release_too_large` | 422 | `POST /admin/releases`: installer over the upload limit | `max_upload_mb` |
| `release_empty_file` | 422 | `POST /admin/releases`: empty installer | |
| `validation_failed` | 422 | any endpoint whose request fails schema validation | `detail` (FastAPI issue list) |
| `rate_limited` | 429 | per-IP limiter on login, register, forgot/reset password, token links, resend verification, password/email change, account delete | `detail` (same text as `message`) |
| `http_error` | any | framework errors such as an unknown route (404) or wrong method (405) | `detail` |
| `internal_error` | 500 | unhandled exception | |
