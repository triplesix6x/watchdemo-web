import uuid
from datetime import datetime

from APP.constants import SubscriptionTier
from APP.entities.subscription import SubscriptionEntity
from APP.exceptions import NotFoundError
from APP.logger import AppLogger
from SPI.db_adapter.repositories.subscription_repo import SubscriptionRepository
from SPI.db_adapter.repositories.user_repo import UserRepository

logger = AppLogger.get_logger()


class SubscriptionService:
    def __init__(
        self,
        user_repo: UserRepository,
        subscription_repo: SubscriptionRepository,
    ) -> None:
        self._user_repo = user_repo
        self._subscription_repo = subscription_repo

    async def grant(
        self,
        user_id: uuid.UUID,
        tier: SubscriptionTier,
        expires_at: datetime,
        granted_by: uuid.UUID,
    ) -> SubscriptionEntity:
        logger.debug("grant: user_id=%s tier=%s expires_at=%s granted_by=%s", user_id, tier, expires_at, granted_by)
        user = await self._user_repo.get_by_id(user_id)
        if not user:
            logger.warning("grant: user not found user_id=%s", user_id)
            raise NotFoundError("User not found")
        sub = await self._subscription_repo.upsert(
            user_id=user_id,
            tier=tier,
            expires_at=expires_at,
            granted_by=granted_by,
        )
        logger.info("grant: success user_id=%s tier=%s", user_id, tier)
        return sub
