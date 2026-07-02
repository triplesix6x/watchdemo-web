import uuid
from dataclasses import dataclass, field
from datetime import datetime

from APP.constants import SubscriptionTier, UserRole
from APP.entities.session import SessionEntity
from APP.entities.user import UserEntity


@dataclass(frozen=True)
class UserFilters:
    """Фильтры для списка пользователей в админке."""

    q: str | None = None
    role: UserRole | None = None
    is_verified: bool | None = None
    is_active: bool | None = None
    tier: SubscriptionTier | None = None
    tier_none: bool = False


@dataclass(frozen=True)
class AdminStats:
    """Сводка по пользователям для админ-дашборда."""

    total: int
    verified: int
    unverified: int
    active: int
    deactivated: int
    tier_none: int
    tier_basic: int
    tier_plus: int
    tier_pro: int
    paying: int
    signups_7d: int
    signups_30d: int


@dataclass(frozen=True)
class AuditLogView:
    """Запись аудита с подставленными именами актора и цели."""

    id: uuid.UUID
    actor_id: uuid.UUID
    actor_username: str | None
    action: str
    target_user_id: uuid.UUID | None
    target_username: str | None
    details: dict
    ip_address: str | None
    created_at: datetime


@dataclass(frozen=True)
class UserDetail:
    """Карточка пользователя: профиль, активные сессии и история аудита."""

    user: UserEntity
    sessions: list[SessionEntity]
    audit: list[AuditLogView] = field(default_factory=list)
