import uuid
from datetime import datetime, timedelta, timezone

from APP.constants import SubscriptionTier
from APP.entities.subscription import SubscriptionEntity
from APP.entities.user import UserEntity
from APP.exceptions import ErrorCode, NotFoundError, ValidationError
from APP.logger import AppLogger
from APP.services.admin_service import check_target
from SPI.db_adapter.repositories.subscription_repo import SubscriptionRepository
from SPI.db_adapter.repositories.user_repo import UserRepository

logger = AppLogger.get_logger()


class SubscriptionService:
    """Выдача, продление и отзыв подписок. Цель проверяется правилом `strict`."""

    def __init__(
        self,
        user_repo: UserRepository,
        subscription_repo: SubscriptionRepository,
    ) -> None:
        self._user_repo = user_repo
        self._subscription_repo = subscription_repo

    async def _target(
        self, actor: UserEntity, user_id: uuid.UUID | None = None, username: str | None = None
    ) -> UserEntity:
        if user_id:
            user = await self._user_repo.get_by_id(user_id)
        elif username:
            user = await self._user_repo.get_by_username(username)
        else:
            raise ValueError("user_id or username required")
        if not user:
            logger.warning("subscription: user not found user_id=%s username=%s", user_id, username)
            raise NotFoundError("User not found", code=ErrorCode.USER_NOT_FOUND)
        check_target(actor, user, "strict")
        return user

    async def grant(
        self,
        actor: UserEntity,
        tier: SubscriptionTier,
        user_id: uuid.UUID | None = None,
        username: str | None = None,
        expires_at: datetime | None = None,
    ) -> SubscriptionEntity:
        user = await self._target(actor, user_id, username)
        sub = await self._subscription_repo.upsert(
            user_id=user.id,
            tier=tier,
            expires_at=expires_at,
            granted_by=actor.id,
        )
        logger.info("grant: success user_id=%s tier=%s by=%s", user.id, tier, actor.id)
        return sub

    async def extend(
        self, actor: UserEntity, user_id: uuid.UUID, days: int
    ) -> SubscriptionEntity:
        """Продлевает платную подписку на `days` дней.

        Истёкшая подписка продлевается от текущего момента, живая — от своей
        даты окончания.

        Raises:
            NotFoundError: Нет пользователя или подписки.
            ValidationError: Продлевать нечего (Basic или бессрочная).
        """
        await self._target(actor, user_id)
        sub = await self._subscription_repo.get_by_user_id(user_id)
        if not sub:
            raise NotFoundError("Subscription not found", code=ErrorCode.SUBSCRIPTION_NOT_FOUND)
        if sub.tier == SubscriptionTier.BASIC:
            raise ValidationError(
                "Basic tier has no expiry to extend", code=ErrorCode.TIER_HAS_NO_EXPIRY
            )
        if sub.expires_at is None:
            raise ValidationError(
                "Subscription has no expiry", code=ErrorCode.SUBSCRIPTION_NO_EXPIRY
            )

        base = max(sub.expires_at, datetime.now(tz=timezone.utc))
        updated = await self._subscription_repo.set_expiry(
            user_id, base + timedelta(days=days), actor.id
        )
        if not updated:
            raise NotFoundError("Subscription not found", code=ErrorCode.SUBSCRIPTION_NOT_FOUND)
        logger.info("extend: user_id=%s days=%d by=%s", user_id, days, actor.id)
        return updated

    async def revoke(
        self, actor: UserEntity, user_id: uuid.UUID
    ) -> tuple[SubscriptionEntity, SubscriptionTier | None]:
        """Возвращает пользователя на бессрочный Basic.

        Returns:
            Пара (новая подписка, тариф до отзыва или `None`, если подписки не было).

        Raises:
            NotFoundError: Пользователя нет.
        """
        await self._target(actor, user_id)
        previous = await self._subscription_repo.get_by_user_id(user_id)
        sub = await self._subscription_repo.upsert(
            user_id=user_id,
            tier=SubscriptionTier.BASIC,
            expires_at=None,
            granted_by=actor.id,
        )
        logger.info("revoke: user_id=%s by=%s", user_id, actor.id)
        return sub, SubscriptionTier(previous.tier) if previous else None
