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


class SubscriptionSummary(BaseModel):
    tier: SubscriptionTier
    effective_tier: SubscriptionTier
    expires_at: datetime | None
    is_expired: bool


class UserListItem(BaseModel):
    id: uuid.UUID
    email: str
    username: str
    role: UserRole
    is_verified: bool
    is_active: bool
    created_at: datetime | None
    subscription: SubscriptionSummary | None


class UsersPage(BaseModel):
    items: list[UserListItem]
    total: int
    page: int
    page_size: int


class StatsResponse(BaseModel):
    total: int
    verified: int
    unverified: int
    active: int
    deactivated: int
    tier_none: int
    tier_basic: int
    tier_plus: int
    tier_pro: int
    paying: int
    signups_7d: int
    signups_30d: int


class SessionItem(BaseModel):
    id: uuid.UUID
    device_info: str | None
    ip_address: str | None
    expires_at: datetime
    last_used_at: datetime
    created_at: datetime | None


class AuditItem(BaseModel):
    id: uuid.UUID
    actor_id: uuid.UUID
    actor_username: str | None
    action: str
    target_user_id: uuid.UUID | None
    target_username: str | None
    details: dict
    ip_address: str | None
    created_at: datetime


class UserDetailResponse(BaseModel):
    id: uuid.UUID
    email: str
    username: str
    role: UserRole
    is_verified: bool
    is_active: bool
    created_at: datetime | None
    subscription: SubscriptionSummary | None
    sessions: list[SessionItem]
    audit: list[AuditItem]


class AuditPage(BaseModel):
    items: list[AuditItem]
    total: int
    page: int
    page_size: int


class SetActiveRequest(BaseModel):
    is_active: bool
