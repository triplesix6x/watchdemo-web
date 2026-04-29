import uuid
from datetime import datetime

from APP.constants import SubscriptionTier
from APP.entities.subscription import SubscriptionEntity
from APP.exceptions import NotFoundError
from SPI.db_adapter.models.subscription import SubscriptionModel
from SPI.db_adapter.repositories.subscription_repo import SubscriptionRepository
from SPI.db_adapter.repositories.user_repo import UserRepository


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
        user = await self._user_repo.get_by_id(user_id)
        if not user:
            raise NotFoundError("User not found")

        sub = await self._subscription_repo.upsert(
            user_id=user_id,
            tier=tier,
            expires_at=expires_at,
            granted_by=granted_by,
        )
        return self._to_entity(sub)

    @staticmethod
    def _to_entity(sub: SubscriptionModel) -> SubscriptionEntity:
        return SubscriptionEntity(
            id=sub.id,
            user_id=sub.user_id,
            tier=SubscriptionTier(sub.tier),
            started_at=sub.started_at,
            expires_at=sub.expires_at,
            granted_by=sub.granted_by,
            is_active=sub.is_active,
            created_at=sub.created_at,
            updated_at=sub.updated_at,
        )
