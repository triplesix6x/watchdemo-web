"""Frozen helper bodies from web0dc31b4, captured before W3 extraction.

Sources: API/views/auth/views.py:27-44 and
API/views/support/views.py:82-97. Dependencies are injected by the characterization
tests so this oracle never imports routers, settings or database services.
Do not update this file to match the extracted implementation.
"""

from __future__ import annotations

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


async def read_image(upload: UploadFile | None) -> svc.Image | None:
    """Reads at most one byte past the cap, so an oversized upload never sits in memory."""
    if upload is None or not upload.filename:
        return None
    data = await upload.read(svc.MAX_IMAGE_BYTES + 1)
    if not data:
        return None
    return svc.sniff_image(data, upload.content_type)


def clean_body(body: str, image: svc.Image | None) -> str:
    body = body.strip()
    if not body and not image:
        raise ValidationError("Write a message or attach an image", code=ErrorCode.SUPPORT_EMPTY_MESSAGE)
    return body
