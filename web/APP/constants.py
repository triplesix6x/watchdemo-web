from enum import StrEnum


class UserRole(StrEnum):
    USER = "user"
    SUPPORT = "support"
    MODERATOR = "moderator"
    ADMIN = "admin"


ROLE_LEVEL: dict[UserRole, int] = {
    UserRole.USER: 0,
    UserRole.SUPPORT: 1,
    UserRole.MODERATOR: 2,
    UserRole.ADMIN: 3,
}


def role_level(role: UserRole) -> int:
    """Возвращает числовой уровень роли для сравнения прав."""
    return ROLE_LEVEL.get(role, 0)


class SubscriptionTier(StrEnum):
    BASIC = "basic"
    PLUS = "plus"
    PRO = "pro"


class TokenType(StrEnum):
    EMAIL_VERIFICATION = "email_verification"
    PASSWORD_RESET = "password_reset"


class EmailMessageType(StrEnum):
    VERIFY_EMAIL = "verify_email"
    RESET_PASSWORD = "reset_password"
    WELCOME = "welcome"
