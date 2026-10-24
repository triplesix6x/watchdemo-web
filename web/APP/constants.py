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


def is_staff_role(role: str) -> bool:
    """Support, moderator or admin: who works the support inbox."""
    return role_level(UserRole(role)) >= ROLE_LEVEL[UserRole.SUPPORT]


STAFF_ROLES: tuple[UserRole, ...] = tuple(r for r in UserRole if is_staff_role(r))


class SubscriptionTier(StrEnum):
    BASIC = "basic"
    PLUS = "plus"
    PRO = "pro"


class ReleaseChannel(StrEnum):
    STABLE = "stable"
    BETA = "beta"


# Каналы, которые видит пользователь без бета-доступа.
PUBLIC_CHANNELS: tuple[ReleaseChannel, ...] = (ReleaseChannel.STABLE,)
# Каналы бета-тестера: беты плюс обычный стабильный поток, чтобы
# тестер не застрял на старой бете, когда stable уже её обогнал.
BETA_CHANNELS: tuple[ReleaseChannel, ...] = (
    ReleaseChannel.STABLE,
    ReleaseChannel.BETA,
)


class Locale(StrEnum):
    """Язык интерфейса и писем пользователя."""

    RU = "ru"
    EN = "en"


class TokenType(StrEnum):
    EMAIL_VERIFICATION = "email_verification"
    PASSWORD_RESET = "password_reset"
    # Смена почты: новый адрес лежит в `payload` токена.
    EMAIL_CHANGE = "email_change"


class EmailMessageType(StrEnum):
    VERIFY_EMAIL = "verify_email"
    RESET_PASSWORD = "reset_password"
    WELCOME = "welcome"
    EMAIL_CHANGE_CONFIRM = "email_change_confirm"
    EMAIL_CHANGE_NOTICE = "email_change_notice"
    PASSWORD_CHANGED = "password_changed"


class CrashKind(StrEnum):
    """Тип падения из отчёта приложения (контракт в SPEC 2.5)."""

    PANIC = "panic"
    UNCLEAN_EXIT = "unclean_exit"
    FRONTEND = "frontend"
    WEBVIEW = "webview"


class CrashStatus(StrEnum):
    NEW = "new"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
# Support tickets (APP/services/support_service.py has the lifecycle).
class TicketStatus(StrEnum):
    OPEN = "open"
    PENDING = "pending"
    RESOLVED = "resolved"
    CLOSED = "closed"


class Direction(StrEnum):
    """`in` from the customer, `out` a staff reply, `note` internal and never delivered."""

    IN = "in"
    OUT = "out"
    NOTE = "note"


class Channel(StrEnum):
    WEB = "web"
    TELEGRAM = "telegram"


class Delivery(StrEnum):
    SENT = "sent"
    FAILED = "failed"
