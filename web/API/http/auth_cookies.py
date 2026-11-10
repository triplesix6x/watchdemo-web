"""Refresh-cookie transport shared by auth and account routes."""

from fastapi import Response

from APP.config import settings

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


def clear_rt_cookie(response: Response) -> None:
    response.delete_cookie(key=_RT_COOKIE, path=_RT_COOKIE_PATH)
