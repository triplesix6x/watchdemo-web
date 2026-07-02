import uuid

from APP.constants import UserRole, role_level
from APP.entities.admin import AdminStats, AuditLogView, UserDetail, UserFilters
from APP.entities.user import UserEntity
from APP.exceptions import NotFoundError, PermissionDeniedError
from APP.logger import AppLogger
from SPI.db_adapter.repositories.audit_log_repo import AuditLogRepository
from SPI.db_adapter.repositories.session_repo import SessionRepository
from SPI.db_adapter.repositories.subscription_repo import SubscriptionRepository
from SPI.db_adapter.repositories.user_repo import UserRepository

logger = AppLogger.get_logger()

_AUDIT_HISTORY_LIMIT = 50


class AdminService:
    """Бизнес-логика админ-панели: списки, статистика, карточки, деактивация."""

    def __init__(
        self,
        user_repo: UserRepository,
        subscription_repo: SubscriptionRepository,
        session_repo: SessionRepository,
        audit_repo: AuditLogRepository,
    ) -> None:
        self._user_repo = user_repo
        self._subscription_repo = subscription_repo
        self._session_repo = session_repo
        self._audit_repo = audit_repo

    async def list_users(
        self, filters: UserFilters, page: int, page_size: int
    ) -> tuple[list[UserEntity], int]:
        """Возвращает страницу пользователей по фильтрам.

        Args:
            filters: Набор фильтров (поиск, роль, статусы, тариф).
            page: Номер страницы, начиная с 1.
            page_size: Размер страницы.

        Returns:
            Пара (пользователи страницы, общее количество).
        """
        offset = (page - 1) * page_size
        items, total = await self._user_repo.list_paginated(offset, page_size, filters)
        logger.info("list_users: page=%d size=%d total=%d", page, page_size, total)
        return items, total

    async def get_stats(self) -> AdminStats:
        """Собирает сводную статистику по пользователям и подпискам."""
        u = await self._user_repo.get_user_stats()
        t = await self._subscription_repo.get_tier_counts()
        total = u["total"]
        return AdminStats(
            total=total,
            verified=u["verified"],
            unverified=total - u["verified"],
            active=u["active"],
            deactivated=total - u["active"],
            tier_none=total - t["total_subs"],
            tier_basic=t["basic"],
            tier_plus=t["plus"],
            tier_pro=t["pro"],
            paying=t["plus"] + t["pro"],
            signups_7d=u["signups_7d"],
            signups_30d=u["signups_30d"],
        )

    async def get_user_detail(
        self, user_id: uuid.UUID, include_audit: bool
    ) -> UserDetail:
        """Возвращает карточку пользователя: профиль, сессии и (опц.) аудит.

        Args:
            user_id: Идентификатор пользователя.
            include_audit: Подгружать ли историю аудита (только для админа).

        Returns:
            UserDetail с профилем, активными сессиями и историей аудита.
        """
        user = await self._user_repo.get_by_id(user_id)
        if not user:
            logger.warning("get_user_detail: not found user_id=%s", user_id)
            raise NotFoundError("User not found")
        sessions = await self._session_repo.get_active_by_user(user_id)
        audit: list[AuditLogView] = []
        if include_audit:
            audit, _ = await self._audit_repo.list_paginated(
                offset=0, limit=_AUDIT_HISTORY_LIMIT, target_user_id=user_id
            )
        return UserDetail(user=user, sessions=sessions, audit=audit)

    async def set_active(
        self, actor: UserEntity, user_id: uuid.UUID, is_active: bool
    ) -> UserEntity:
        """Включает или блокирует аккаунт с проверкой прав актора.

        Нельзя трогать себя и пользователя с равной или большей ролью
        (равную роль может блокировать только админ). При блокировке
        завершаются все активные сессии цели.

        Args:
            actor: Кто выполняет действие.
            user_id: Кого блокируют/разблокируют.
            is_active: Целевое состояние аккаунта.

        Returns:
            Обновлённый профиль пользователя.
        """
        if actor.id == user_id:
            raise PermissionDeniedError("Cannot change your own activation status")

        target = await self._user_repo.get_by_id(user_id)
        if not target:
            raise NotFoundError("User not found")

        actor_level = role_level(UserRole(actor.role))
        target_level = role_level(UserRole(target.role))
        if target_level > actor_level or (
            target_level == actor_level and UserRole(actor.role) is not UserRole.ADMIN
        ):
            raise PermissionDeniedError("Cannot modify a user with equal or higher role")

        await self._user_repo.set_active(user_id, is_active)
        if not is_active:
            await self._session_repo.deactivate_all(user_id)
        logger.info("set_active: user_id=%s is_active=%s by=%s", user_id, is_active, actor.id)
        return target.model_copy(update={"is_active": is_active})

    async def list_audit(
        self, page: int, page_size: int
    ) -> tuple[list[AuditLogView], int]:
        """Возвращает страницу журнала аудита с именами актора и цели.

        Args:
            page: Номер страницы, начиная с 1.
            page_size: Размер страницы.

        Returns:
            Пара (записи аудита, общее количество).
        """
        offset = (page - 1) * page_size
        return await self._audit_repo.list_paginated(offset, page_size)
