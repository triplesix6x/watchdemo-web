import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from APP.constants import SubscriptionTier
from SPI.db_adapter.base_repo import SQLAlchemyRepository
from SPI.db_adapter.models.subscription import SubscriptionModel


class SubscriptionRepository(SQLAlchemyRepository[SubscriptionModel]):
    model = SubscriptionModel

    async def get_by_user_id(self, user_id: uuid.UUID) -> SubscriptionModel | None:
        query = select(SubscriptionModel).where(SubscriptionModel.user_id == user_id)
        return await self._execute_one_or_none(query)

    async def create(self, user_id: uuid.UUID) -> SubscriptionModel:
        sub = SubscriptionModel(
            user_id=user_id,
            tier=SubscriptionTier.BASIC.value,
            started_at=datetime.now(tz=timezone.utc),
            expires_at=None,
            granted_by=None,
        )
        self.session.add(sub)
        await self.session.flush()
        await self.session.refresh(sub)
        return sub

    async def upsert(
        self,
        user_id: uuid.UUID,
        tier: SubscriptionTier,
        expires_at: datetime,
        granted_by: uuid.UUID,
    ) -> SubscriptionModel:
        query = (
            select(SubscriptionModel)
            .where(SubscriptionModel.user_id == user_id)
            .with_for_update()
        )
        sub = await self._execute_one_or_none(query)
        now = datetime.now(tz=timezone.utc)
        if sub:
            sub.tier = tier.value
            sub.started_at = now
            sub.expires_at = expires_at
            sub.granted_by = granted_by
            await self.session.flush()
            await self.session.refresh(sub)
        else:
            sub = SubscriptionModel(
                user_id=user_id,
                tier=tier.value,
                started_at=now,
                expires_at=expires_at,
                granted_by=granted_by,
            )
            self.session.add(sub)
            await self.session.flush()
            await self.session.refresh(sub)
        return sub
