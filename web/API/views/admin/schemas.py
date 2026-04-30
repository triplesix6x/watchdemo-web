import uuid
from datetime import datetime

from pydantic import BaseModel, model_validator

from APP.constants import SubscriptionTier, UserRole


class GrantSubscriptionRequest(BaseModel):
    user_id: uuid.UUID | None = None
    username: str | None = None
    tier: SubscriptionTier
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def require_one_identifier(self) -> "GrantSubscriptionRequest":
        if not self.user_id and not self.username:
            raise ValueError("Either user_id or username must be provided")
        return self


class GrantSubscriptionResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    tier: SubscriptionTier
    effective_tier: SubscriptionTier
    started_at: datetime
    expires_at: datetime | None
    granted_by: uuid.UUID | None
    is_expired: bool


class GrantRoleRequest(BaseModel):
    user_id: uuid.UUID | None = None
    username: str | None = None
    role: UserRole

    @model_validator(mode="after")
    def require_one_identifier(self) -> "GrantRoleRequest":
        if not self.user_id and not self.username:
            raise ValueError("Either user_id or username must be provided")
        return self


class GrantRoleResponse(BaseModel):
    id: uuid.UUID
    username: str
    email: str
    role: UserRole
