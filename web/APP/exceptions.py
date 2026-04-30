class AppException(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class NotFoundError(AppException):
    pass


class AlreadyExistsError(AppException):
    pass


class InvalidCredentialsError(AppException):
    def __init__(self, message: str, attempts_remaining: int | None = None):
        super().__init__(message)
        self.attempts_remaining = attempts_remaining


class AccountLockedError(AppException):
    def __init__(self, message: str, retry_after_seconds: int):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


class EmailNotVerifiedError(AppException):
    pass


class TokenExpiredError(AppException):
    pass


class InvalidTokenError(AppException):
    pass


class PermissionDeniedError(AppException):
    pass


class PasswordValidationError(AppException):
    pass
