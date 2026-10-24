"""The bot service's door into support. Mounted outside /api, so the public nginx (which
proxies only /api/) never routes here; web's port 8000 is still published on the host,
so every call must carry X-Internal-Token. Without INTERNAL_API_TOKEN the API is 404.

Write endpoints commit before they answer: get_db's own commit runs after the response
is sent, and the bot acts on the answer at once (an outbox read right after a report
must already see it).
"""

import hmac
import uuid

from fastapi import APIRouter, Depends, File, Form, Header, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from API.views.support.views import clean_body, read_image
from APP.config import settings
from APP.constants import Locale
from APP.exceptions import ErrorCode, InvalidTokenError, NotFoundError
from APP.services import support_service as svc
from SPI.db_adapter.db import AnnDBSession
from SPI.db_adapter.models.support import SupportContactModel
# Telegram's own cap on a message text.
MAX_TG_TEXT = 4096


def _internal_auth(token: str | None = Header(None, alias="X-Internal-Token")) -> None:
    expected = settings.internal_api_token
    if not expected:
        raise NotFoundError("Not found", code=ErrorCode.HTTP_ERROR)
    if not hmac.compare_digest((token or "").encode(), expected.encode()):
        raise InvalidTokenError("Bad internal token", code=ErrorCode.TOKEN_INVALID)


router = APIRouter(prefix="/internal/support/telegram", dependencies=[Depends(_internal_auth)], include_in_schema=False)


async def _contact(
    db: AnnDBSession,
    tg_user_id: int = Form(),
    tg_chat_id: int = Form(),
    username: str | None = Form(None, max_length=64),
    display_name: str = Form("", max_length=255),
    locale: Locale = Form(Locale.EN),
) -> SupportContactModel:
    """Upserts the contact as a side effect of resolving the dependency, so every inbound
    route refreshes it and clears `blocked_at`, /start included: unblocking a bot in
    Telegram sends /start."""
    return await svc.telegram_contact(db, tg_user_id, tg_chat_id, username, display_name, locale)


class InboundResult(BaseModel):
    # True for the first message of a new ticket: the bot answers it with "received".
    new_ticket: bool


@router.post("/contact", status_code=204, dependencies=[Depends(_contact)])
async def touch_contact(db: AnnDBSession):
    """An update that carries no support message: /start or content support refuses."""
    await db.commit()


@router.post("/messages", response_model=InboundResult)
async def inbound(
    db: AnnDBSession,
    contact: SupportContactModel = Depends(_contact),
    tg_message_id: int = Form(),
    text: str = Form("", max_length=MAX_TG_TEXT),
    image: UploadFile | None = File(None),
):
    img = await read_image(image)
    routed = await svc.telegram_inbound(db, contact, clean_body(text, img), tg_message_id, image=img)
    await db.commit()
    return InboundResult(new_ticket=bool(routed and routed.new_ticket))


@router.post("/edits", status_code=204)
async def edit(
    db: AnnDBSession,
    contact: SupportContactModel = Depends(_contact),
    tg_message_id: int = Form(),
    text: str = Form("", max_length=MAX_TG_TEXT),
):
    await svc.telegram_edit(db, contact, tg_message_id, text)
    await db.commit()


class OutboxItem(BaseModel):
    chat_id: int
    body: str
    image_mime: str | None


@router.get("/outbox/{message_id}", response_model=OutboxItem)
async def outbox_item(message_id: uuid.UUID, db: AnnDBSession):
    """404 support_reply_not_found: no such Telegram reply. 409 support_reply_settled: it
    already has an outcome. The bot drops the job on either code."""
    message, contact = await svc.telegram_outbox(db, message_id)
    return OutboxItem(chat_id=contact.tg_chat_id, body=message.body, image_mime=message.image_mime if message.image_path else None)


@router.get("/outbox/{message_id}/image")
async def outbox_image(message_id: uuid.UUID, db: AnnDBSession):
    message, _ = await svc.telegram_outbox(db, message_id)
    path = svc.image_file(message.image_path) if message.image_path else None
    if not path or not path.is_file():
        raise NotFoundError("Image not found", code=ErrorCode.SUPPORT_IMAGE_NOT_FOUND)
    return FileResponse(path, media_type=message.image_mime)


class DeliveryReport(BaseModel):
    sent: bool
    tg_message_id: int | None = None
    error: str | None = None
    # Telegram answered 403: the user blocked the bot.
    blocked: bool = False


@router.post("/outbox/{message_id}/delivery", status_code=204)
async def report_delivery(message_id: uuid.UUID, report: DeliveryReport, db: AnnDBSession):
    await svc.record_delivery(
        db, message_id, sent=report.sent, tg_message_id=report.tg_message_id, error=report.error, blocked=report.blocked
    )
    await db.commit()
