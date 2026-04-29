import uuid
from datetime import datetime

from pydantic import BaseModel

from APP.constants import SubscriptionTier


class GrantSubscriptionRequest(BaseModel):
    user_id: uuid.UUID
    tier: SubscriptionTier
    expires_at: datetime


class GrantSubscriptionResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    tier: SubscriptionTier
    effective_tier: SubscriptionTier
    started_at: datetime
    expires_at: datetime | None
    granted_by: uuid.UUID | None
    is_expired: bool
