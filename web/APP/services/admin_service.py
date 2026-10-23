import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from APP.constants import TokenType, UserRole, role_level
from APP.entities.admin import (
    AdminStats,
    AdminTimeseries,
    AuditLogView,
    ExpiringSubscription,
    UserDetail,
    UserFilters,
)
from APP.entities.user import UserEntity
from APP.exceptions import ErrorCode, NotFoundError, PermissionDeniedError
from APP.logger import AppLogger
from APP.services.session_revoker import SessionRevoker
from SPI.db_adapter.repositories.audit_log_repo import AuditLogRepository
from SPI.db_adapter.repositories.session_repo import SessionRepository
from SPI.db_adapter.repositories.subscription_repo import SubscriptionRepository
from SPI.db_adapter.repositories.token_repo import OneTimeTokenRepository
from SPI.db_adapter.repositories.user_repo import UserRepository

logger = AppLogger.get_logger()

_AUDIT_HISTORY_LIMIT = 50
_EXPIRING_WINDOW_DAYS = 7
_EXPIRING_LIMIT = 50


# strict: не себя и только младшую роль (равную может трогать лишь админ).
#   Для действий, которые меняют доступ: блокировка, сеансы, сброс пароля, подписки.
# not_higher: любую роль не старше своей, себя тоже. Для безобидных флагов:
#   бета-канал, ручное подтверждение почты.
TargetRule = Literal["strict", "not_higher"]


def check_target(actor: UserEntity, target: UserEntity, rule: TargetRule) -> None:
    """Бросает, если актору нельзя трогать цель по правилу `rule`.

    Raises:
        PermissionDeniedError: `cannot_target_self` или `target_role_too_high`.
    """
    actor_level = role_level(UserRole(actor.role))
    target_level = role_level(UserRole(target.role))
    if rule == "strict":
        if actor.id == target.id:
            raise PermissionDeniedError(
                "Cannot perform this action on yourself", code=ErrorCode.CANNOT_TARGET_SELF
            )
        too_high = target_level > actor_level or (
            target_level == actor_level and UserRole(actor.role) is not UserRole.ADMIN
        )
    else:
        too_high = target_level > actor_level
    if too_high:
        raise PermissionDeniedError(
            "Cannot modify a user with equal or higher role", code=ErrorCode.TARGET_ROLE_TOO_HIGH
        )


def fill_days(counts: dict[date, int], days: int, today: date) -> list[tuple[date, int]]:
    """Ряд за `days` дней по `today` включительно, с нулями в днях без регистраций."""
    start = today - timedelta(days=days - 1)
    series = [start + timedelta(days=i) for i in range(days)]
    return [(d, counts.get(d, 0)) for d in series]


class AdminService:
    """Бизнес-логика админ-панели: списки, статистика, карточки, деактивация."""

    def __init__(
        self,
        user_repo: UserRepository,
        subscription_repo: SubscriptionRepository,
        session_repo: SessionRepository,
        audit_repo: AuditLogRepository,
        token_repo: OneTimeTokenRepository,
        revoker: SessionRevoker,
    ) -> None:
        self._user_repo = user_repo
        self._subscription_repo = subscription_repo
        self._session_repo = session_repo
        self._audit_repo = audit_repo
        self._token_repo = token_repo
        self._revoker = revoker

    async def get_target(
        self, actor: UserEntity, user_id: uuid.UUID, rule: TargetRule
    ) -> UserEntity:
        """Возвращает цель, если актору можно её трогать по правилу `rule`.

        Raises:
            NotFoundError: Пользователя нет.
            PermissionDeniedError: См. `check_target`.
        """
        target = await self._user_repo.get_by_id(user_id)
        if not target:
            raise NotFoundError("User not found", code=ErrorCode.USER_NOT_FOUND)
        check_target(actor, target, rule)
        return target

    async def get_password_reset_target(
        self, actor: UserEntity, user_id: uuid.UUID
    ) -> UserEntity:
        """Цель админского сброса пароля.

        Выключенному аккаунту письмо не шлём, как и `AuthService.send_password_reset`,
        но админу отвечаем явной ошибкой, а не молчим.

        Raises:
            PermissionDeniedError: `target_deactivated` или правило `strict`.
        """
        target = await self.get_target(actor, user_id, "strict")
        if not target.is_active:
            raise PermissionDeniedError(
                "Account is deactivated", code=ErrorCode.TARGET_DEACTIVATED
            )
        return target

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
        # Тарифы считаются только по активным аккаунтам, «без тарифа» тоже.
        return AdminStats(
            total=total,
            verified=u["verified"],
            unverified=total - u["verified"],
            active=u["active"],
            deactivated=total - u["active"],
            tier_none=u["active"] - t["total_subs"],
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
            raise NotFoundError("User not found", code=ErrorCode.USER_NOT_FOUND)
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
        target = await self.get_target(actor, user_id, "strict")
        await self._user_repo.set_active(user_id, is_active)
        if not is_active:
            await self._revoker.revoke_all(user_id)
        logger.info("set_active: user_id=%s is_active=%s by=%s", user_id, is_active, actor.id)
        return target.model_copy(update={"is_active": is_active})

    async def set_beta_tester(
        self, actor: UserEntity, user_id: uuid.UUID, is_beta_tester: bool
    ) -> UserEntity:
        """Открывает или закрывает пользователю бета-канал обновлений.

        В отличие от блокировки аккаунта, флаг ни на что внутри приложения
        не влияет — только на то, какие сборки отдаёт апдейтер. Поэтому
        ограничение мягче: запрещено лишь трогать более старшую роль.

        Args:
            actor: Кто выполняет действие.
            user_id: Кому меняют доступ.
            is_beta_tester: Целевое состояние флага.

        Returns:
            Обновлённый профиль пользователя.

        Raises:
            NotFoundError: Пользователя нет.
            PermissionDeniedError: Цель старше актора по роли.
        """
        target = await self.get_target(actor, user_id, "not_higher")
        await self._user_repo.set_beta_tester(user_id, is_beta_tester)
        logger.info(
            "set_beta_tester: user_id=%s value=%s by=%s", user_id, is_beta_tester, actor.id
        )
        return target.model_copy(update={"is_beta_tester": is_beta_tester})

    async def revoke_sessions(self, actor: UserEntity, user_id: uuid.UUID) -> int:
        """Завершает все сеансы цели с проверкой прав; возвращает их число."""
        await self.get_target(actor, user_id, "strict")
        count = await self._revoker.revoke_all(user_id)
        logger.info("revoke_sessions: user_id=%s count=%d by=%s", user_id, count, actor.id)
        return count

    async def verify_user(self, actor: UserEntity, user_id: uuid.UUID) -> UserEntity:
        """Подтверждает почту вручную, когда письмо не дошло.

        Ограничение как у бета-флага: нельзя трогать более старшую роль.
        """
        target = await self.get_target(actor, user_id, "not_higher")
        await self._user_repo.mark_verified(user_id)
        await self._token_repo.invalidate_all(user_id, TokenType.EMAIL_VERIFICATION)
        logger.info("verify_user: user_id=%s by=%s", user_id, actor.id)
        return target.model_copy(update={"is_verified": True})

    async def get_timeseries(self, days: int) -> AdminTimeseries:
        """Регистрации по дням (UTC), раскладка по тарифам и подписки, истекающие за неделю."""
        now = datetime.now(tz=timezone.utc)
        today = now.date()
        since = datetime.combine(today - timedelta(days=days - 1), datetime.min.time(), timezone.utc)
        counts = await self._user_repo.signups_by_day(since)

        active = (await self._user_repo.get_user_stats())["active"]
        t = await self._subscription_repo.get_tier_counts()
        expiring = await self._subscription_repo.list_expiring(
            until=now + timedelta(days=_EXPIRING_WINDOW_DAYS), limit=_EXPIRING_LIMIT
        )
        return AdminTimeseries(
            signups=fill_days(counts, days, today),
            tiers={
                "none": active - t["total_subs"],
                "basic": t["basic"],
                "plus": t["plus"],
                "pro": t["pro"],
            },
            expiring_soon=[
                ExpiringSubscription(
                    user_id=sub.user_id,
                    username=username,
                    tier=sub.tier,
                    expires_at=sub.expires_at,
                )
                for sub, username in expiring
            ],
        )

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
