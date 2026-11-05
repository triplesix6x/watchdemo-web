from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from APP.constants import SubscriptionTier

UsageKind = Literal["demo_import", "custom_sets", "demo_groups"]


class StrictDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OperationRequest(StrictDTO):
    library_id: UUID
    operation_ids: list[UUID] = Field(min_length=1, max_length=1000)

    @field_validator("operation_ids")
    @classmethod
    def unique_ids(cls, values):
        if len(set(values)) != len(values):
            raise ValueError("Duplicate operation IDs")
        return values


class ReserveRequest(OperationRequest):
    kind: UsageKind


class GroupRequest(StrictDTO):
    library_id: UUID
    group_ids: list[UUID] = Field(max_length=1000)

    @field_validator("group_ids")
    @classmethod
    def unique_ids(cls, values):
        if len(set(values)) != len(values):
            raise ValueError("Duplicate group IDs")
        return values


class ReconcileRequest(GroupRequest):
    generation: int | None = Field(default=None, ge=0)


class FeatureAccess(StrictDTO):
    id: str
    allowed: bool
    min_tier: SubscriptionTier
    monthly_limit: int | None
    limit: int | None
    limit_period: Literal["calendar_month", "activation_month"] | None
    scope: Literal["account"] = "account"
    used: int
    reserved: int
    remaining: int | None
    resets_at: datetime | None


class AccessSnapshot(StrictDTO):
    protocol_version: Literal[1] = 1
    server_time: datetime
    tier: SubscriptionTier
    paid_cycle_anchor: datetime | None
    subscription_expires_at: datetime | None
    group_generation: int
    features: list[FeatureAccess]
    lease: str | None


class UsageOperation(StrictDTO):
    operation_id: UUID
    kind: UsageKind | None
    state: Literal["unknown", "reserved", "committed", "cancelled", "expired"]
    expires_at: datetime | None

    @model_validator(mode="after")
    def validate_unknown_identity(self):
        if self.kind is None and (self.state not in ("unknown", "cancelled") or self.expires_at is not None):
            raise ValueError("Unbound identities must be unknown or cancellation tombstones")
        if self.state == "unknown" and self.kind is not None:
            raise ValueError("Unknown identities have no kind")
        return self


class UsageResponse(StrictDTO):
    operations: list[UsageOperation]
    access: AccessSnapshot


class GroupResponse(StrictDTO):
    generation: int
    access: AccessSnapshot


class GroupResetRequest(StrictDTO):
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Reason must not be blank")
        return value.strip()


class GroupResetResponse(StrictDTO):
    generation: int
    removed_groups: int
    cancelled_reservations: int
