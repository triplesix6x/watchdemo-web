import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, case, func, or_, select

from APP.constants import SubscriptionTier
from APP.entities.subscription import SubscriptionEntity
from SPI.db_adapter.base_repo import SQLAlchemyRepository
from SPI.db_adapter.models.subscription import SubscriptionModel


class SubscriptionRepository(SQLAlchemyRepository[SubscriptionModel]):
    model = SubscriptionModel

    def to_entity(self, sub: SubscriptionModel) -> SubscriptionEntity:
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

    async def get_by_user_id(self, user_id: uuid.UUID) -> SubscriptionEntity | None:
        query = select(SubscriptionModel).where(SubscriptionModel.user_id == user_id)
        sub = await self._execute_one_or_none(query)
        return self.to_entity(sub) if sub else None

    async def get_tier_counts(self) -> dict[str, int]:
        """Считает подписки по эффективному тарифу с учётом истечения срока.

        Returns:
            Словарь с ключами total_subs, basic, plus, pro (эффективные тарифы).
        """
        now = datetime.now(tz=timezone.utc)
        not_expired = or_(
            SubscriptionModel.expires_at.is_(None),
            SubscriptionModel.expires_at > now,
        )
        expired = and_(
            SubscriptionModel.expires_at.is_not(None),
            SubscriptionModel.expires_at <= now,
        )
        plus_active = and_(SubscriptionModel.tier == SubscriptionTier.PLUS.value, not_expired)
        pro_active = and_(SubscriptionModel.tier == SubscriptionTier.PRO.value, not_expired)
        basic_eff = or_(SubscriptionModel.tier == SubscriptionTier.BASIC.value, expired)

        query = select(
            func.count(),
            func.coalesce(func.sum(case((basic_eff, 1), else_=0)), 0),
            func.coalesce(func.sum(case((plus_active, 1), else_=0)), 0),
            func.coalesce(func.sum(case((pro_active, 1), else_=0)), 0),
        )
        row = (await self.session.execute(query)).one()
        return {"total_subs": row[0], "basic": row[1], "plus": row[2], "pro": row[3]}

    async def create(self, user_id: uuid.UUID) -> SubscriptionEntity:
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
        return self.to_entity(sub)

    async def upsert(
        self,
        user_id: uuid.UUID,
        tier: SubscriptionTier,
        expires_at: datetime,
        granted_by: uuid.UUID,
    ) -> SubscriptionEntity:
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
        return self.to_entity(sub)
