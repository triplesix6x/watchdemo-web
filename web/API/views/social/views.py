"""Browser and native provider transport. Redirects never carry login credentials."""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field, field_validator

from API.http.auth_cookies import _set_rt_cookie, clear_rt_cookie
from API.views.auth.schemas import normalize_username
from APP.config import settings
from APP.constants import Locale
from APP.dependencies import CurrentAuth, Audit, get_social_service
from APP.exceptions import AppException
from APP.rate_limiter import (SlidingWindowRateLimiter, account_rate_limit, client_ip,
                              login_rate_limit, make_rate_limit_dep)
from APP.services.social_service import SocialService, rejected
from APP.services.auth_service import AuthService

router = APIRouter(prefix="/auth/social", tags=["social auth"])
Service = Annotated[SocialService, Depends(get_social_service)]
Provider = Literal["steam", "faceit"]
_COOKIE_PATH = "/api/v1/auth/social"
_BROWSER = "social_browser"
_FLOW = "social_flow"
# Allow a native client to poll every two seconds without spending login attempts.
_desktop_poll_limit = make_rate_limit_dep(SlidingWindowRateLimiter(120, 60))


class StartRequest(BaseModel):
    intent: Literal["login", "link", "reauth"] = "login"


class DesktopStartRequest(BaseModel):
    provider: Provider
    code_challenge: str = Field(pattern=r"^[0-9a-f]{64}$")


class DesktopPollRequest(BaseModel):
    code_verifier: str = Field(pattern=r"^[0-9a-f]{64}$")


class FlowRequest(BaseModel):
    flow_id: str = Field(pattern=r"^[0-9a-f]{64}$")


class RegistrationRequest(FlowRequest):
    username: str = Field(max_length=50)
    locale: Locale = Locale.RU

    @field_validator("username")
    @classmethod
    def username_valid(cls, value):
        return normalize_username(value)


class EmailRequest(BaseModel):
    new_email: EmailStr


class PasswordRequest(BaseModel):
    new_password: str = Field(max_length=128)
    sign_out_others: bool = True


class DeleteRequest(BaseModel):
    username: str = Field(max_length=50)


def cookie(response, key, value, seconds):
    response.set_cookie(key, value, max_age=seconds, path=_COOKIE_PATH,
                        httponly=True, secure=settings.app.cookie_secure, samesite="lax")


def flow(request, flow_id=None):
    state = request.cookies.get(_FLOW, "")
    if flow_id is not None and AuthService._hash_token(state) != flow_id:
        raise rejected("The sign-in changed in another tab. Start again.")
    return state, request.cookies.get(_BROWSER, "")


def same_origin(request: Request):
    # Login CSRF protection for cookie-producing/sensitive JSON requests.
    if request.headers.get("origin") != settings.app.frontend_url.rstrip("/"):
        raise rejected("Start this operation from the WatchDemo website")


@router.get("/providers")
async def providers(service: Service):
    return service.availability()


@router.get("/connections")
async def connections(response: Response, auth: CurrentAuth, service: Service):
    response.headers["Cache-Control"] = "no-store"
    linked = {identity.provider for identity in await service.repo.linked(auth.user.id)}
    return {provider: {"available": available, "linked": provider in linked}
            for provider, available in service.availability().items()}


async def begin(provider, intent, request, response, service, auth=None):
    import secrets
    same_origin(request)
    browser = request.cookies.get(_BROWSER) or secrets.token_urlsafe(32)
    state, url = await service.start(provider, intent, browser, auth)
    cookie(response, _BROWSER, browser, 1800)
    cookie(response, _FLOW, state, 600)
    return {"authorization_url": url}


@router.post("/desktop/start", dependencies=[Depends(login_rate_limit)])
async def desktop_start(body: DesktopStartRequest, response: Response, service: Service):
    response.headers["Cache-Control"] = "no-store"
    return await service.desktop_start(body.provider, body.code_challenge)


@router.get("/desktop/launch")
async def desktop_launch(request: Request, service: Service):
    import secrets
    browser = request.cookies.get(_BROWSER) or secrets.token_urlsafe(32)
    state, url = await service.desktop_launch(request.query_params.get("ticket", ""), browser)
    response = RedirectResponse(url, status_code=303)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    cookie(response, _BROWSER, browser, 1800)
    cookie(response, _FLOW, state, 600)
    return response


@router.post("/desktop/poll", dependencies=[Depends(_desktop_poll_limit)])
async def desktop_poll(body: DesktopPollRequest, request: Request, response: Response, service: Service):
    response.headers["Cache-Control"] = "no-store"
    return await service.desktop_poll(body.code_verifier, request.headers.get("User-Agent"), client_ip(request))


@router.post("/desktop/approve", dependencies=[Depends(login_rate_limit)])
async def desktop_approve(body: FlowRequest, request: Request, response: Response, service: Service):
    same_origin(request)
    await service.desktop_approve(*flow(request, body.flow_id))
    response.headers["Cache-Control"] = "no-store"
    response.delete_cookie(_FLOW, path=_COOKIE_PATH)
    return {"status": "approved"}


@router.post("/{provider}/start", dependencies=[Depends(login_rate_limit)])
async def start(provider: Provider, body: StartRequest, request: Request, response: Response, service: Service):
    # Authenticated intents have a separate endpoint; no optional-auth ambiguity.
    if body.intent != "login":
        raise rejected("Use the authenticated connection endpoint")
    return await begin(provider, body.intent, request, response, service)


@router.post("/{provider}/connect", dependencies=[Depends(account_rate_limit)])
async def connect(provider: Provider, body: StartRequest, request: Request, response: Response,
                  auth: CurrentAuth, service: Service):
    if body.intent not in {"link", "reauth"}:
        raise rejected("Select link or reauthentication")
    return await begin(provider, body.intent, request, response, service, auth)


@router.get("/{provider}/callback")
async def callback(provider: Provider, request: Request, service: Service):
    state = request.query_params.get("state", "")
    response = RedirectResponse(settings.app.frontend_url.rstrip("/") + "/auth/social/complete", status_code=303)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    try:
        # Reject ambiguous/doubled protocol parameters rather than silently picking one.
        params = dict(request.query_params)
        if len(params) != len(request.query_params.multi_items()) or any(len(v) > 8192 for v in params.values()):
            raise rejected("Invalid provider response")
        if state != request.cookies.get(_FLOW, ""):
            raise rejected("Start again in this browser")
        await service.callback(provider, state, request.cookies.get(_BROWSER, ""), params)
        cookie(response, _FLOW, state, 600)
    except AppException:
        # The UI displays a recoverable generic error without reflecting provider data.
        response = RedirectResponse(settings.app.frontend_url.rstrip("/") + "/auth/social/complete?failed=1", status_code=303)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
    return response


@router.get("/status")
async def status(request: Request, response: Response, service: Service):
    response.headers["Cache-Control"] = "no-store"
    return await service.status(*flow(request))


@router.post("/register", status_code=201, dependencies=[Depends(login_rate_limit)])
async def register(body: RegistrationRequest, request: Request, service: Service):
    same_origin(request)
    await service.register(*flow(request, body.flow_id), body.username, body.locale)
    return {"stage": "login_ready"}


@router.post("/finish", dependencies=[Depends(login_rate_limit)])
async def finish(body: FlowRequest, request: Request, response: Response, service: Service):
    same_origin(request)
    result = await service.finish(*flow(request, body.flow_id), request.headers.get("User-Agent"), client_ip(request))
    _set_rt_cookie(response, result.refresh_token, settings.app.refresh_token_ttl_days)
    response.delete_cookie(_FLOW, path=_COOKIE_PATH)
    # A full document navigation restores via the established /auth/refresh lifecycle.
    # Neither access nor refresh tokens are exposed to redirect URLs or JS here.
    return {"redirect": "/account"}


@router.post("/email", status_code=202, dependencies=[Depends(account_rate_limit)])
async def email(body: EmailRequest, request: Request, auth: CurrentAuth, service: Service):
    same_origin(request)
    await service.consume_reauth(*flow(request), auth)
    await service.auth.request_email_change(auth.user, str(body.new_email), "", provider_verified=True)
    return {"message": "Check the new email address for a confirmation link"}


@router.post("/password", status_code=204, dependencies=[Depends(account_rate_limit)])
async def password(body: PasswordRequest, request: Request, auth: CurrentAuth, service: Service):
    same_origin(request)
    await service.consume_reauth(*flow(request), auth)
    await service.auth.change_password(auth.user, auth.session_id, "", body.new_password,
                                       body.sign_out_others, provider_verified=True)


@router.delete("/account", status_code=204, dependencies=[Depends(account_rate_limit)])
async def delete(body: DeleteRequest, request: Request, response: Response,
                 auth: CurrentAuth, service: Service, audit: Audit):
    same_origin(request)
    await service.consume_reauth(*flow(request), auth)
    await service.auth.delete_account(auth.user, "", body.username, provider_verified=True)
    await audit("delete_account", target_user_id=auth.user.id)
    clear_rt_cookie(response)
