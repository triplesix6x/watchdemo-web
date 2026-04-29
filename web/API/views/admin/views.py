from fastapi import APIRouter, Depends

from API.views.admin.schemas import GrantSubscriptionResponse, GrantSubscriptionRequest
from APP.constants import UserRole
from APP.dependencies import AnnSubscriptionService, AuthContext, require_role

router = APIRouter(prefix="/admin", tags=["admin"])

_require_admin = require_role(UserRole.ADMIN)


@router.post("/subscriptions/grant", response_model=GrantSubscriptionResponse)
async def grant_subscription(
    body: GrantSubscriptionRequest,
    service: AnnSubscriptionService,
    auth: AuthContext = Depends(_require_admin),
):
    sub = await service.grant(
        user_id=body.user_id,
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
