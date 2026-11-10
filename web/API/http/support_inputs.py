"""Multipart input handling shared by public and internal support routes."""

from fastapi import UploadFile

from APP.exceptions import ErrorCode, ValidationError
from APP.services import support_service as svc


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
