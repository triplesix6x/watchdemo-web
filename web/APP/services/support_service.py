"""Support tickets: one inbound router for web and Telegram, staff replies with delivery,
and the periodic status sweeps.

The ticket lifecycle (decision 6a):

    customer message: none | closed -> new open ticket; open | pending | resolved -> open
    staff reply:      open | pending | resolved -> pending (a closed ticket refuses replies)
    resolved_at + 72 h -> closed;  pending idle 7 d -> resolved
    staff may set any status by hand.

A contact has at most one non-closed ticket; a partial unique index enforces it, and the
router retries once when two first messages race.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from APP.config import settings
from APP.constants import Channel, Delivery, Direction, TicketStatus, is_staff_role
from APP.exceptions import ConflictError, ErrorCode, NotFoundError, ValidationError
from APP.logger import AppLogger
from SPI.db_adapter.models.support import SupportContactModel, SupportMessageModel, SupportTicketModel
from SPI.db_adapter.models.user import UserModel
from SPI.telegram_adapter.bot_api import BotApi, TelegramError

logger = AppLogger.get_logger()

MAX_IMAGE_BYTES = 10 * 1024 * 1024
TG_CAPTION_LIMIT = 1024


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------- Images ----------


@dataclass(frozen=True)
class Image:
    data: bytes
    mime: str
    ext: str


_MIME_ALIASES = {"image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg"}


def sniff_image(data: bytes, declared: str | None = None) -> Image:
    """Accepts PNG, JPEG or WebP by magic bytes, up to 10 MB.

    The stored type comes from the bytes. A declared type that names a different image
    format is refused too: something upstream mislabelled the file.
    """
    if len(data) > MAX_IMAGE_BYTES:
        raise ValidationError(
            "Image is too large", code=ErrorCode.SUPPORT_IMAGE_TOO_LARGE, max_mb=MAX_IMAGE_BYTES // 2**20
        )
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        img = Image(data, "image/png", "png")
    elif data.startswith(b"\xff\xd8\xff"):
        img = Image(data, "image/jpeg", "jpg")
    elif len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        img = Image(data, "image/webp", "webp")
    else:
        raise ValidationError("Only PNG, JPEG and WebP images", code=ErrorCode.SUPPORT_IMAGE_INVALID)
    if declared:
        declared = _MIME_ALIASES.get(declared.lower(), declared.lower())
        if declared != img.mime and declared != "application/octet-stream":
            raise ValidationError("Image type does not match its content", code=ErrorCode.SUPPORT_IMAGE_INVALID)
    return img


def store_image(img: Image, now: datetime) -> str:
    """Writes the image to the support volume and returns its path relative to it."""
    rel = f"{now:%Y}/{now:%m}/{uuid.uuid4()}.{img.ext}"
    path = Path(settings.support.dir) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(img.data)
    return rel


def image_file(rel: str) -> Path:
    return Path(settings.support.dir) / rel


# ---------- Contacts ----------


async def web_contact(session: AsyncSession, user_id: uuid.UUID, username: str, locale: str) -> SupportContactModel:
    contact = await session.scalar(select(SupportContactModel).where(SupportContactModel.user_id == user_id))
    if contact:
        return contact
    contact = SupportContactModel(
        channel=Channel.WEB, user_id=user_id, display_name=username, locale=locale, created_at=utcnow()
    )
    return await _insert_contact(session, contact, SupportContactModel.user_id == user_id)


async def telegram_contact(
    session: AsyncSession,
    tg_user_id: int,
    chat_id: int,
    username: str | None,
    display_name: str,
    locale: str,
) -> SupportContactModel:
    """Finds or creates the contact and refreshes what Telegram tells us. Any inbound
    message clears `blocked_at`: the user is talking to the bot again."""
    contact = await session.scalar(select(SupportContactModel).where(SupportContactModel.tg_user_id == tg_user_id))
    if not contact:
        contact = await _insert_contact(
            session,
            SupportContactModel(channel=Channel.TELEGRAM, tg_user_id=tg_user_id, created_at=utcnow()),
            SupportContactModel.tg_user_id == tg_user_id,
        )
    contact.tg_chat_id = chat_id
    contact.tg_username = username
    contact.display_name = display_name[:255]
    contact.locale = locale
    contact.blocked_at = None
    return contact


async def _insert_contact(session: AsyncSession, contact: SupportContactModel, same) -> SupportContactModel:
    try:
        async with session.begin_nested():
            session.add(contact)
    except IntegrityError:
        # A parallel first message created it; take that one.
        return await session.scalar(select(SupportContactModel).where(same))
    return contact


# ---------- Inbound routing ----------


@dataclass(frozen=True)
class Routed:
    ticket: SupportTicketModel
    message: SupportMessageModel
    new_ticket: bool


async def route_inbound(
    session: AsyncSession,
    contact: SupportContactModel,
    body: str,
    *,
    image: Image | None = None,
    tg_message_id: int | None = None,
    now: datetime | None = None,
) -> Routed:
    """The one entry point for a customer message, from the site or from Telegram."""
    now = now or utcnow()
    image_path = store_image(image, now) if image else None
    for attempt in (1, 2):
        ticket = await session.scalar(
            select(SupportTicketModel)
            .where(SupportTicketModel.contact_id == contact.id, SupportTicketModel.status != TicketStatus.CLOSED)
            .with_for_update()
        )
        # Checked here as well as in the periodic sweep, so the 72 h window is exact.
        if ticket and ticket.status == TicketStatus.RESOLVED and ticket.resolved_at < _resolved_cutoff(now):
            set_status(ticket, TicketStatus.CLOSED, now)
            await session.flush()
            ticket = None
        new_ticket = ticket is None
        if new_ticket:
            ticket = SupportTicketModel(contact_id=contact.id, created_at=now)
            try:
                async with session.begin_nested():
                    session.add(ticket)
            except IntegrityError:
                # Another message of the same contact opened a ticket first; append to it.
                if attempt == 2:
                    raise
                continue
        set_status(ticket, TicketStatus.OPEN, now)
        ticket.unread_count += 1
        ticket.last_activity_at = now
        message = SupportMessageModel(
            ticket_id=ticket.id,
            direction=Direction.IN,
            body=body,
            image_path=image_path,
            image_mime=image.mime if image else None,
            tg_message_id=tg_message_id,
            created_at=now,
        )
        session.add(message)
        await session.flush()
        return Routed(ticket, message, new_ticket)
    raise AssertionError("unreachable")


def _resolved_cutoff(now: datetime) -> datetime:
    return now - timedelta(hours=settings.support.resolved_close_hours)


def set_status(ticket: SupportTicketModel, status: TicketStatus, now: datetime | None = None) -> None:
    """The one place a ticket changes status: inbound messages, staff replies, the inbox
    controls and the 72 h close all go through it."""
    now = now or utcnow()
    ticket.status = status
    if status == TicketStatus.OPEN:
        ticket.waiting_since = ticket.waiting_since or now
        ticket.resolved_at = ticket.closed_at = None
    elif status == TicketStatus.PENDING:
        # The 7-day idle window starts now.
        ticket.waiting_since = None
        ticket.last_activity_at = now
        ticket.resolved_at = ticket.closed_at = None
    elif status == TicketStatus.RESOLVED:
        ticket.waiting_since = None
        ticket.resolved_at = now
        ticket.closed_at = None
    else:
        ticket.waiting_since = None
        ticket.closed_at = now


# ---------- Staff side ----------


async def load_ticket(session: AsyncSession, ticket_id: uuid.UUID, lock: bool = False) -> SupportTicketModel:
    ticket = await session.get(SupportTicketModel, ticket_id, with_for_update=lock)
    if not ticket:
        raise NotFoundError("Ticket not found", code=ErrorCode.SUPPORT_TICKET_NOT_FOUND)
    return ticket


async def staff_message(
    session: AsyncSession,
    ticket_id: uuid.UUID,
    author_id: uuid.UUID,
    body: str,
    *,
    note: bool,
    image: Image | None,
    bot: BotApi | None,
    now: datetime | None = None,
) -> SupportMessageModel:
    """A staff reply (delivered to the contact) or an internal note (never delivered).

    The reply commits before it goes to Telegram: the ticket lock is not held across the
    network call, and a message the customer received always exists in the inbox.
    """
    now = now or utcnow()
    ticket = await load_ticket(session, ticket_id, lock=True)
    if not note and ticket.status == TicketStatus.CLOSED:
        raise ConflictError("Ticket is closed", code=ErrorCode.SUPPORT_TICKET_CLOSED)
    message = SupportMessageModel(
        id=uuid.uuid7(),
        ticket_id=ticket.id,
        direction=Direction.NOTE if note else Direction.OUT,
        author_id=author_id,
        body=body,
        image_path=store_image(image, now) if image else None,
        image_mime=image.mime if image else None,
        created_at=now,
    )
    session.add(message)
    if note:
        await session.flush()
        return message
    set_status(ticket, TicketStatus.PENDING, now)
    ticket.unread_count = 0
    ticket.first_reply_at = ticket.first_reply_at or now
    ticket.assignee_id = ticket.assignee_id or author_id
    await session.commit()
    contact = await session.get(SupportContactModel, ticket.contact_id)
    await deliver(contact, message, image, bot, now)
    await session.commit()
    return message


async def update_ticket(
    session: AsyncSession,
    ticket_id: uuid.UUID,
    *,
    status: TicketStatus | None,
    assignee_id: uuid.UUID | None,
    set_assignee: bool,
) -> None:
    """Inbox controls. `set_assignee` tells "unassign" (None) from "leave as is"."""
    ticket = await load_ticket(session, ticket_id, lock=True)
    if set_assignee:
        if assignee_id and not await _is_active_staff(session, assignee_id):
            raise ValidationError("Assignee must be staff", code=ErrorCode.SUPPORT_ASSIGNEE_INVALID)
        ticket.assignee_id = assignee_id
    if status and status != ticket.status:
        set_status(ticket, status)
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError:
        # Reopening a closed ticket while the contact already has a newer one.
        raise ConflictError(
            "The contact already has another open ticket", code=ErrorCode.SUPPORT_TICKET_CONFLICT
        ) from None


async def mark_read(session: AsyncSession, ticket_id: uuid.UUID) -> None:
    (await load_ticket(session, ticket_id, lock=True)).unread_count = 0


async def _is_active_staff(session: AsyncSession, user_id: uuid.UUID) -> bool:
    user = await session.get(UserModel, user_id)
    return bool(user and user.is_active and is_staff_role(user.role))


async def deliver(
    contact: SupportContactModel,
    message: SupportMessageModel,
    image: Image | None,
    bot: BotApi | None,
    now: datetime,
) -> None:
    """Pushes a staff reply to the contact's channel and records the outcome on the message.

    Web has nothing to push: the widget polls. Telegram failures never raise: a 403 means
    the user blocked the bot, and the reply stays in the thread marked failed.
    """
    if contact.channel == Channel.WEB:
        message.delivery = Delivery.SENT
        return
    if bot is None or contact.tg_chat_id is None:
        message.delivery, message.delivery_error = Delivery.FAILED, "telegram bot is disabled"
        return
    try:
        sent = None
        caption = message.body if len(message.body) <= TG_CAPTION_LIMIT else ""
        if image:
            params = {"chat_id": contact.tg_chat_id}
            if caption:
                params["caption"] = caption
            sent = await bot.send("sendPhoto", params, files={"photo": (f"image.{image.ext}", image.data, image.mime)})
        if message.body and not (image and caption):
            sent = await bot.send("sendMessage", {"chat_id": contact.tg_chat_id, "text": message.body})
        message.delivery = Delivery.SENT
        message.tg_message_id = (sent or {}).get("message_id")
    except TelegramError as e:
        message.delivery = Delivery.FAILED
        message.delivery_error = f"{e.status}: {e.description}"[:1000]
        if e.status == 403:
            contact.blocked_at = now
        logger.warning(f"support reply {message.id} not delivered: {message.delivery_error}")


# ---------- Periodic sweeps ----------


async def close_stale_resolved(session: AsyncSession, now: datetime) -> int:
    result = await session.execute(
        update(SupportTicketModel)
        .where(SupportTicketModel.status == TicketStatus.RESOLVED, SupportTicketModel.resolved_at < _resolved_cutoff(now))
        .values(status=TicketStatus.CLOSED, closed_at=now)
    )
    return result.rowcount


async def resolve_idle_pending(session: AsyncSession, now: datetime) -> int:
    cutoff = now - timedelta(days=settings.support.pending_resolve_days)
    result = await session.execute(
        update(SupportTicketModel)
        .where(SupportTicketModel.status == TicketStatus.PENDING, SupportTicketModel.last_activity_at < cutoff)
        .values(status=TicketStatus.RESOLVED, resolved_at=now)
    )
    return result.rowcount
