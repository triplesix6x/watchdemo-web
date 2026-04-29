import uuid
from datetime import datetime, timezone

from APP.constants import SubscriptionTier
from APP.entities.base import Entity


class SubscriptionEntity(Entity):
    id: uuid.UUID
    user_id: uuid.UUID
    tier: SubscriptionTier
    started_at: datetime
    expires_at: datetime | None
    granted_by: uuid.UUID | None

    @property
    def effective_tier(self) -> SubscriptionTier:
        if self.expires_at and self.expires_at < datetime.now(tz=timezone.utc):
            return SubscriptionTier.BASIC
        return self.tier

    @property
    def is_expired(self) -> bool:
        return self.expires_at is not None and self.expires_at < datetime.now(tz=timezone.utc)
