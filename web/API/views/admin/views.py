from fastapi import APIRouter, Depends

from API.views.admin.schemas import (
    GrantRoleRequest,
    GrantRoleResponse,
    GrantSubscriptionResponse,
    GrantSubscriptionRequest,
)
from APP.constants import UserRole
from APP.dependencies import AnnSubscriptionService, AnnUserService, AuthContext, require_role

router = APIRouter(prefix="/admin", tags=["admin"])

_require_admin = require_role(UserRole.ADMIN)
_require_moderator = require_role(UserRole.MODERATOR)


@router.post("/subscriptions/grant", response_model=GrantSubscriptionResponse)
async def grant_subscription(
    body: GrantSubscriptionRequest,
    service: AnnSubscriptionService,
    auth: AuthContext = Depends(_require_moderator),
):
    sub = await service.grant(
        user_id=body.user_id,
        username=body.username,
        tier=body.tier,
        expires_at=body.expires_at,
        granted_by=auth.user.id,
    )
    return GrantSubscriptionResponse(
        id=sub.id,
        user_id=sub.user_id,
        tier=sub.tier,
        effective_tier=sub.effective_tier,
        started_at=sub.started_at,
        expires_at=sub.expires_at,
        granted_by=sub.granted_by,
        is_expired=sub.is_expired,
    )


@router.post("/users/role", response_model=GrantRoleResponse)
async def grant_role(
    body: GrantRoleRequest,
    service: AnnUserService,
    auth: AuthContext = Depends(_require_admin),  # noqa: ARG001
):
    user = await service.update_role(
        user_id=body.user_id,
        username=body.username,
        role=body.role,
    )
    return GrantRoleResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        role=UserRole(user.role),
    )
