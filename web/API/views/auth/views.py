from fastapi import APIRouter, Depends, Request, Response

from API.views.auth.schemas import (
    RegisterRequest,
    LoginResponse,
    LoginRequest,
    TokenRefreshResponse,
    TokenRefreshRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    ResendVerificationRequest,
)
from API.views.auth.utils import build_user_response
from APP.config import settings
from APP.dependencies import AnnAuthService, CurrentAuth
from APP.exceptions import InvalidTokenError
from APP.rate_limiter import (
    login_rate_limit,
    register_rate_limit,
    password_rate_limit,
    token_rate_limit,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_RT_COOKIE = "rt"
_RT_COOKIE_PATH = "/api/v1/auth"


def _set_rt_cookie(response: Response, token: str, ttl_days: int) -> None:
    response.set_cookie(
        key=_RT_COOKIE,
        value=token,
        httponly=True,
        secure=settings.app.cookie_secure,
        samesite="lax",
        max_age=ttl_days * 86400,
        path=_RT_COOKIE_PATH,
    )


def _clear_rt_cookie(response: Response) -> None:
    response.delete_cookie(key=_RT_COOKIE, path=_RT_COOKIE_PATH)


@router.post("/register", status_code=201, dependencies=[Depends(register_rate_limit)])
async def register(body: RegisterRequest, service: AnnAuthService):
    await service.register(
        email=str(body.email),
        username=body.username,
        password=body.password,
    )
    return {"message": "Registration successful. Please check your email to verify your account."}


@router.post("/login", response_model=LoginResponse, dependencies=[Depends(login_rate_limit)])
async def login(body: LoginRequest, request: Request, response: Response, service: AnnAuthService):
    device_info = request.headers.get("User-Agent")
    ip_address = request.client.host if request.client else None
    result = await service.login(
        login=body.login,
        password=body.password,
        device_info=device_info,
        ip_address=ip_address,
    )
    _set_rt_cookie(response, result.refresh_token, settings.app.refresh_token_ttl_days)
    return LoginResponse(
        access_token=result.access_token,
        refresh_token=result.refresh_token,
        user=build_user_response(result.user),
    )


@router.post("/refresh", response_model=TokenRefreshResponse, dependencies=[Depends(token_rate_limit)])
async def refresh(body: TokenRefreshRequest, request: Request, response: Response, service: AnnAuthService):
    # Browser: uses httpOnly cookie. Non-browser client: sends token in body.
    rt = request.cookies.get(_RT_COOKIE) or body.refresh_token
    if not rt:
        raise InvalidTokenError("Refresh token required")
    pair = await service.refresh_tokens(rt)
    _set_rt_cookie(response, pair.refresh_token, settings.app.refresh_token_ttl_days)
    return TokenRefreshResponse(access_token=pair.access_token, refresh_token=pair.refresh_token)


@router.post("/logout", status_code=204)
async def logout(auth: CurrentAuth, response: Response, service: AnnAuthService):
    await service.logout(auth.session_id)
    _clear_rt_cookie(response)


@router.get("/verify-email", status_code=200, dependencies=[Depends(token_rate_limit)])
async def verify_email(token: str, service: AnnAuthService):
    await service.verify_email(token)
    return {"message": "Email verified successfully"}


@router.post("/forgot-password", status_code=202, dependencies=[Depends(password_rate_limit)])
async def forgot_password(body: ForgotPasswordRequest, service: AnnAuthService):
    await service.forgot_password(str(body.email))
    return {"message": "If this email is registered you will receive a password reset link"}


@router.post("/reset-password", status_code=200, dependencies=[Depends(token_rate_limit)])
async def reset_password(body: ResetPasswordRequest, service: AnnAuthService):
    await service.reset_password(body.token, body.new_password)
    return {"message": "Password reset successfully. Please log in with your new password."}


@router.post("/resend-verification", status_code=202, dependencies=[Depends(password_rate_limit)])
async def resend_verification(body: ResendVerificationRequest, service: AnnAuthService):
    await service.resend_verification(str(body.email))
    return {"message": "If this email is registered and unverified you will receive a new verification link"}
