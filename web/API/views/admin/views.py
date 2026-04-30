from fastapi import APIRouter, Depends, Request

from API.views.admin.schemas import (
    GrantRoleRequest,
    GrantRoleResponse,
    GrantSubscriptionResponse,
    GrantSubscriptionRequest,
)
from APP.constants import UserRole
from APP.dependencies import AnnAuditLogRepo, AnnSubscriptionService, AnnUserService, AuthContext, require_role

router = APIRouter(prefix="/admin", tags=["admin"])

_require_admin = require_role(UserRole.ADMIN)
_require_moderator = require_role(UserRole.MODERATOR)


@router.post("/subscriptions/grant", response_model=GrantSubscriptionResponse)
async def grant_subscription(
    body: GrantSubscriptionRequest,
    request: Request,
    service: AnnSubscriptionService,
    audit: AnnAuditLogRepo,
    auth: AuthContext = Depends(_require_moderator),
):
    sub = await service.grant(
        user_id=body.user_id,
        username=body.username,
        tier=body.tier,
        expires_at=body.expires_at,
        granted_by=auth.user.id,
    )
    await audit.log(
        actor_id=auth.user.id,
        action="grant_subscription",
        target_user_id=sub.user_id,
        details={
            "tier": str(sub.tier),
            "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
        },
        ip_address=request.client.host if request.client else None,
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
    request: Request,
    service: AnnUserService,
    audit: AnnAuditLogRepo,
    auth: AuthContext = Depends(_require_admin),
):
    user = await service.update_role(
        user_id=body.user_id,
        username=body.username,
        role=body.role,
    )
    await audit.log(
        actor_id=auth.user.id,
        action="grant_role",
        target_user_id=user.id,
        details={"role": str(body.role)},
        ip_address=request.client.host if request.client else None,
    )
    return GrantRoleResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        role=UserRole(user.role),
    )
