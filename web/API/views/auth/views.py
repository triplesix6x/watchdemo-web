from fastapi import APIRouter, Request
from API.views.auth.schemas import RegisterRequest, LoginResponse, LoginRequest, TokenRefreshResponse, \
    TokenRefreshRequest, ForgotPasswordRequest, ResetPasswordRequest, ResendVerificationRequest
from API.views.auth.utils import build_user_response
from APP.dependencies import AnnAuthService, CurrentAuth

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register", status_code=201)
async def register(body: RegisterRequest, service: AnnAuthService):
    user = await service.register(
        email=str(body.email),
        username=body.username,
        password=body.password,
    )
    return {"message": "Registration successful. Please check your email to verify your account."}


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, request: Request, service: AnnAuthService):
    device_info = request.headers.get("User-Agent")
    ip_address = request.client.host if request.client else None
    result = await service.login(
        login=body.login,
        password=body.password,
        device_info=device_info,
        ip_address=ip_address,
    )
    return LoginResponse(
        access_token=result.access_token,
        refresh_token=result.refresh_token,
        user=build_user_response(result.user),
    )


@router.post("/refresh", response_model=TokenRefreshResponse)
async def refresh(body: TokenRefreshRequest, service: AnnAuthService):
    pair = await service.refresh_tokens(body.refresh_token)
    return TokenRefreshResponse(access_token=pair.access_token, refresh_token=pair.refresh_token)


@router.post("/logout", status_code=204)
async def logout(auth: CurrentAuth, service: AnnAuthService):
    await service.logout(auth.session_id)


@router.get("/verify-email", status_code=200)
async def verify_email(token: str, service: AnnAuthService):
    await service.verify_email(token)
    return {"message": "Email verified successfully"}


@router.post("/forgot-password", status_code=202)
async def forgot_password(body: ForgotPasswordRequest, service: AnnAuthService):
    await service.forgot_password(str(body.email))
    return {"message": "If this email is registered you will receive a password reset link"}


@router.post("/reset-password", status_code=200)
async def reset_password(body: ResetPasswordRequest, service: AnnAuthService):
    await service.reset_password(body.token, body.new_password)
    return {"message": "Password reset successfully. Please log in with your new password."}


@router.post("/resend-verification", status_code=202)
async def resend_verification(body: ResendVerificationRequest, service: AnnAuthService):
    await service.resend_verification(str(body.email))
    return {"message": "If this email is registered and unverified you will receive a new verification link"}
