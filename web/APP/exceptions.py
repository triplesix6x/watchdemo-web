class AppException(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class NotFoundError(AppException):
    pass


class AlreadyExistsError(AppException):
    pass


class InvalidCredentialsError(AppException):
    pass


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
