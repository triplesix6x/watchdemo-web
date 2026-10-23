import uuid

from fastapi import APIRouter, Depends, Response

from API.views.auth.schemas import UserResponse
from API.views.auth.utils import build_user_response
from API.views.auth.views import clear_rt_cookie
from API.views.user.schemas import (
    ChangeEmailRequest,
    ChangePasswordRequest,
    DeleteAccountRequest,
    SessionResponse,
    UpdateProfileRequest,
)
from APP.dependencies import AnnAuthService, AnnUserService, Audit, CurrentAuth
from APP.rate_limiter import account_rate_limit

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
async def get_profile(auth: CurrentAuth, service: AnnUserService):
    return build_user_response(await service.get_profile(auth.user.id))


@router.patch("/me", response_model=UserResponse)
async def update_profile(body: UpdateProfileRequest, auth: CurrentAuth, service: AnnUserService):
    user = await service.update_profile(auth.user.id, username=body.username, locale=body.locale)
    return build_user_response(user)


@router.post("/me/password", status_code=204, dependencies=[Depends(account_rate_limit)])
async def change_password(body: ChangePasswordRequest, auth: CurrentAuth, service: AnnAuthService):
    await service.change_password(
        user=auth.user,
        session_id=auth.session_id,
        current_password=body.current_password,
        new_password=body.new_password,
        sign_out_others=body.sign_out_others,
    )


@router.post("/me/email", status_code=202, dependencies=[Depends(account_rate_limit)])
async def request_email_change(body: ChangeEmailRequest, auth: CurrentAuth, service: AnnAuthService):
    await service.request_email_change(auth.user, str(body.new_email), body.password)
    return {"message": "Check the new address for a confirmation link"}


@router.delete("/me", status_code=204, dependencies=[Depends(account_rate_limit)])
async def delete_account(
    body: DeleteAccountRequest,
    response: Response,
    auth: CurrentAuth,
    service: AnnAuthService,
    audit: Audit,
):
    await service.delete_account(auth.user, body.password, body.username)
    # Строка аудита остаётся после обезличивания: видно, кто и когда ушёл.
    await audit(
        "delete_account",
        target_user_id=auth.user.id,
    )
    clear_rt_cookie(response)


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
            is_current=s.id == auth.session_id,
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
