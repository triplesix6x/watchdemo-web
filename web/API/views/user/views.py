import uuid
from fastapi import APIRouter
from API.views.user.schemas import SessionResponse, ProfileResponse, SubscriptionResponse
from APP.dependencies import AnnUserService, CurrentAuth

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=ProfileResponse)
async def get_profile(auth: CurrentAuth, service: AnnUserService):
    user = await service.get_profile(auth.user.id)
    sub = None
    if user.subscription:
        s = user.subscription
        sub = SubscriptionResponse(
            tier=s.tier,
            effective_tier=s.effective_tier,
            expires_at=s.expires_at,
            is_expired=s.is_expired,
        )
    return ProfileResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        role=user.role,
        is_verified=user.is_verified,
        subscription=sub,
    )


@router.get("/me/sessions", response_model=list[SessionResponse])
async def list_sessions(auth: CurrentAuth, service: AnnUserService):
    sessions = await service.list_sessions(auth.user.id)
    return [
        SessionResponse(
            id=s.id,
            device_info=s.device_info,
            ip_address=s.ip_address,
            expires_at=s.expires_at,
            last_used_at=s.last_used_at,
            created_at=s.created_at,
        )
        for s in sessions
    ]


@router.delete("/me/sessions/{session_id}", status_code=204)
async def revoke_session(
    session_id: uuid.UUID, auth: CurrentAuth, service: AnnUserService
):
    await service.revoke_session(auth.user.id, session_id)


@router.delete("/me/sessions", status_code=204)
async def revoke_all_other_sessions(auth: CurrentAuth, service: AnnUserService):
    await service.revoke_all_other_sessions(auth.user.id, auth.session_id)
