from enum import StrEnum


class ErrorCode(StrEnum):
    """Stable machine-readable error codes. The site localizes by code.

    Keep in sync with docs/ERROR-CODES.md (a test checks both directions).
    """

    # Auth and account
    INVALID_CREDENTIALS = "invalid_credentials"
    TOO_MANY_ATTEMPTS = "too_many_attempts"
    EMAIL_NOT_VERIFIED = "email_not_verified"
    ACCOUNT_DEACTIVATED = "account_deactivated"
    INVALID_PASSWORD = "invalid_password"
    PASSWORD_WEAK = "password_weak"
    EMAIL_TAKEN = "email_taken"
    USERNAME_TAKEN = "username_taken"
    EMAIL_UNCHANGED = "email_unchanged"
    USERNAME_MISMATCH = "username_mismatch"
    USER_NOT_FOUND = "user_not_found"
    SESSION_NOT_FOUND = "session_not_found"
    # Tokens
    TOKEN_MISSING = "token_missing"
    TOKEN_INVALID = "token_invalid"
    TOKEN_EXPIRED = "token_expired"
    SESSION_REVOKED = "session_revoked"
    # Admin permissions
    INSUFFICIENT_ROLE = "insufficient_role"
    CANNOT_TARGET_SELF = "cannot_target_self"
    TARGET_ROLE_TOO_HIGH = "target_role_too_high"
    TARGET_DEACTIVATED = "target_deactivated"
    # Subscriptions
    SUBSCRIPTION_NOT_FOUND = "subscription_not_found"
    TIER_HAS_NO_EXPIRY = "tier_has_no_expiry"
    SUBSCRIPTION_NO_EXPIRY = "subscription_no_expiry"
    # Releases
    RELEASE_NOT_FOUND = "release_not_found"
    RELEASE_DUPLICATE = "release_duplicate"
    RELEASE_BAD_VERSION = "release_bad_version"
    RELEASE_BAD_PLATFORM = "release_bad_platform"
    RELEASE_BAD_SIGNATURE = "release_bad_signature"
    RELEASE_TOO_LARGE = "release_too_large"
    RELEASE_EMPTY_FILE = "release_empty_file"
    # Crash reports
    CRASH_PAYLOAD_TOO_LARGE = "crash_payload_too_large"
    CRASH_BAD_ENCODING = "crash_bad_encoding"
    CRASH_GROUP_NOT_FOUND = "crash_group_not_found"
    CRASH_REPORT_NOT_FOUND = "crash_report_not_found"
    SYMBOLS_TOO_LARGE = "symbols_too_large"
    # Transport
    VALIDATION_FAILED = "validation_failed"
    RATE_LIMITED = "rate_limited"
    HTTP_ERROR = "http_error"
    INTERNAL_ERROR = "internal_error"


class AppException(Exception):
    """Base error. The handler sends `{message, code, **extra}` with `status`.

    `extra` keys with a `None` value are dropped from the body.
    """

    status: int = 400

    def __init__(self, message: str, *, code: ErrorCode, **extra) -> None:
        self.message = message
        self.code = code
        self.extra = {k: v for k, v in extra.items() if v is not None}
        super().__init__(message)


class NotFoundError(AppException):
    status = 404


class AlreadyExistsError(AppException):
    status = 409


class InvalidCredentialsError(AppException):
    status = 401

    def __init__(self, message: str, attempts_remaining: int | None = None) -> None:
        super().__init__(
            message, code=ErrorCode.INVALID_CREDENTIALS, attempts_remaining=attempts_remaining
        )


class AccountLockedError(AppException):
    status = 429

    def __init__(self, message: str, retry_after_seconds: int) -> None:
        super().__init__(
            message, code=ErrorCode.TOO_MANY_ATTEMPTS, retry_after_seconds=retry_after_seconds
        )


class EmailNotVerifiedError(AppException):
    status = 403

    def __init__(self, message: str) -> None:
        super().__init__(message, code=ErrorCode.EMAIL_NOT_VERIFIED)


class TokenExpiredError(AppException):
    status = 401


class InvalidTokenError(AppException):
    status = 401


class PermissionDeniedError(AppException):
    status = 403


class ValidationError(AppException):
    """Input passed the schema but broke a business rule."""

    status = 422


class PayloadTooLargeError(AppException):
    status = 413


class RateLimitedError(AppException):
    status = 429
