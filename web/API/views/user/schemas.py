import uuid
from datetime import datetime
from pydantic import BaseModel
from APP.constants import SubscriptionTier, UserRole

class SubscriptionResponse(BaseModel):
    tier: SubscriptionTier
    effective_tier: SubscriptionTier
    expires_at: datetime | None
    is_expired: bool


class ProfileResponse(BaseModel):
    id: uuid.UUID
    email: str
    username: str
    role: UserRole
    is_verified: bool
    subscription: SubscriptionResponse | None


class SessionResponse(BaseModel):
    id: uuid.UUID
    device_info: str | None
    ip_address: str | None
    expires_at: datetime
    last_used_at: datetime
    created_at: datetime | None

