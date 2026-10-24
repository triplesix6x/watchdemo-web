import hmac
import uuid

from fastapi import APIRouter, Depends, File, Form, Header, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.exc import IntegrityError

from API.views.support.schemas import (
    ContactCard,
    ContactUser,
    CustomerMessage,
    OtherTicket,
    StaffMessage,
    StaffUser,
    TicketDetail,
    TicketItem,
    TicketsPage,
    UnreadResponse,
    UpdateTicketRequest,
)
from APP.config import settings
from APP.constants import ROLE_LEVEL, UserRole
from APP.dependencies import AuthContext, CurrentAuth, require_role
from APP.exceptions import (
    ConflictError,
    ErrorCode,
    InvalidTokenError,
    NotFoundError,
    RateLimitedError,
    ValidationError,
)
from APP.logger import AppLogger
from APP.rate_limiter import SlidingWindowRateLimiter
from APP.services import support_inbox as inbox
from APP.services import support_service as svc
from APP.services.support_service import Channel, TicketStatus
from APP.services.telegram_bot import handle_update
from SPI.db_adapter.db import AnnDBSession
from SPI.db_adapter.models.support import SupportContactModel, SupportMessageModel, SupportTicketModel
from SPI.db_adapter.repositories.user_repo import UserRepository
from SPI.telegram_adapter.bot_api import get_bot

logger = AppLogger.get_logger()

customer_router = APIRouter(prefix="/support", tags=["support"])
staff_router = APIRouter(prefix="/admin/support", tags=["support"])
telegram_router = APIRouter(prefix="/telegram", tags=["support"])

_require_support = require_role(UserRole.SUPPORT)
_message_limiter = SlidingWindowRateLimiter(max_requests=20, window_seconds=60)
MAX_BODY = 4000


def _image_url(m: SupportMessageModel) -> str | None:
    return f"/api/v1/support/images/{m.id}" if m.image_path else None


def _customer_message(m: SupportMessageModel) -> CustomerMessage:
    return CustomerMessage(id=m.id, direction=m.direction, body=m.body, image_url=_image_url(m), created_at=m.created_at)


def _staff_message(m: SupportMessageModel, author: str | None) -> StaffMessage:
    return StaffMessage(
        id=m.id,
        direction=m.direction,
        body=m.body,
        image_url=_image_url(m),
        author_id=m.author_id,
        author_username=author,
        delivery=m.delivery,
        delivery_error=m.delivery_error,
        edited_at=m.edited_at,
        created_at=m.created_at,
    )


def _ticket_item(r: inbox.TicketRow) -> TicketItem:
    t, c = r.ticket, r.contact
    return TicketItem(
        id=t.id,
        number=t.number,
        status=t.status,
        channel=c.channel,
        contact_name=(r.user_name if c.channel == Channel.WEB else c.display_name) or c.display_name,
        tg_username=c.tg_username,
        preview=r.preview,
        preview_direction=r.preview_direction,
        preview_has_image=bool(r.preview_has_image),
        unread_count=t.unread_count,
        waiting_since=t.waiting_since,
        assignee_id=t.assignee_id,
        assignee_username=r.assignee_name,
        last_activity_at=t.last_activity_at,
        created_at=t.created_at,
    )


async def _read_image(upload: UploadFile | None) -> svc.Image | None:
    """Reads at most one byte past the cap, so an oversized upload never sits in memory."""
    if upload is None or not upload.filename:
        return None
    data = await upload.read(svc.MAX_IMAGE_BYTES + 1)
    if not data:
        return None
    return svc.sniff_image(data, upload.content_type)


def _clean_body(body: str, image: svc.Image | None) -> str:
    body = body.strip()
    if not body and not image:
        raise ValidationError("Write a message or attach an image", code=ErrorCode.SUPPORT_EMPTY_MESSAGE)
    return body


# ---------- Customer ----------


@customer_router.get("/messages", response_model=list[CustomerMessage])
async def my_messages(db: AnnDBSession, auth: CurrentAuth, after: uuid.UUID | None = None):
    """The caller's conversation, oldest first. With `after`, only newer messages; the
    answer may repeat a few recent ones (see `support_inbox.STREAM_OVERLAP`), so the
    client merges by id."""
    return [_customer_message(m) for m in await inbox.customer_stream(db, auth.user.id, after)]


@customer_router.post("/messages", response_model=CustomerMessage, status_code=201)
async def send_message(
    db: AnnDBSession,
    auth: CurrentAuth,
    body: str = Form("", max_length=MAX_BODY),
    image: UploadFile | None = File(None),
):
    if not await _message_limiter.is_allowed(str(auth.user.id)):
        raise RateLimitedError("Too many messages", code=ErrorCode.RATE_LIMITED)
    img = await _read_image(image)
    text = _clean_body(body, img)
    contact = await svc.web_contact(db, auth.user.id, auth.user.username, auth.user.locale)
    routed = await svc.route_inbound(db, contact, text, image=img)
    return _customer_message(routed.message)


@customer_router.get("/images/{message_id}")
async def get_image(message_id: uuid.UUID, db: AnnDBSession, auth: CurrentAuth):
    staff = ROLE_LEVEL.get(UserRole(auth.user.role), 0) >= ROLE_LEVEL[UserRole.SUPPORT]
    m = await inbox.image_for(db, message_id, auth.user.id, staff)
    path = svc.image_file(m.image_path) if m else None
    if not m or not path.is_file():
        raise NotFoundError("Image not found", code=ErrorCode.SUPPORT_IMAGE_NOT_FOUND)
    return FileResponse(
        path,
        media_type=m.image_mime,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
            "Cache-Control": "private, max-age=86400",
        },
    )


# ---------- Staff ----------


async def _ticket(db, ticket_id: uuid.UUID, lock: bool = False) -> SupportTicketModel:
    ticket = await db.get(SupportTicketModel, ticket_id, with_for_update=lock)
    if not ticket:
        raise NotFoundError("Ticket not found", code=ErrorCode.SUPPORT_TICKET_NOT_FOUND)
    return ticket


@staff_router.get("/tickets", response_model=TicketsPage)
async def list_tickets(
    db: AnnDBSession,
    status: TicketStatus | None = None,
    channel: Channel | None = None,
    q: str | None = Query(None, max_length=255),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    auth: AuthContext = Depends(_require_support),
):
    rows, total = await inbox.list_tickets(
        db, status=status, channel=channel, q=(q or "").strip() or None, page=page, page_size=page_size
    )
    return TicketsPage(items=[_ticket_item(r) for r in rows], total=total, page=page, page_size=page_size)


@staff_router.get("/unread", response_model=UnreadResponse)
async def unread(db: AnnDBSession, auth: AuthContext = Depends(_require_support)):
    return UnreadResponse(tickets=await inbox.unread_tickets(db))


async def _detail(db, ticket_id: uuid.UUID) -> TicketDetail:
    row = await inbox.ticket_row(db, ticket_id)
    if not row:
        raise NotFoundError("Ticket not found", code=ErrorCode.SUPPORT_TICKET_NOT_FOUND)
    c = row.contact
    user = None
    if c.user_id:
        u = await UserRepository(db).get_by_id(c.user_id)
        if u:
            tier = u.subscription.effective_tier if u.subscription else None
            user = ContactUser(id=u.id, email=u.email, username=u.username, tier=tier)
    others = await inbox.other_tickets(db, c.id, ticket_id) if c.channel == Channel.TELEGRAM else []
    return TicketDetail(
        ticket=_ticket_item(row),
        messages=[_staff_message(m, a) for m, a in await inbox.thread(db, ticket_id)],
        contact=ContactCard(
            id=c.id,
            channel=c.channel,
            display_name=c.display_name,
            locale=c.locale,
            blocked_at=c.blocked_at,
            created_at=c.created_at,
            user=user,
            tg_username=c.tg_username,
            tg_user_id=c.tg_user_id,
            other_tickets=[OtherTicket(id=t.id, number=t.number, status=t.status, created_at=t.created_at) for t in others],
        ),
        assignees=[StaffUser(id=i, username=n) for i, n in await inbox.staff_users(db)],
    )


@staff_router.get("/tickets/{ticket_id}", response_model=TicketDetail)
async def get_ticket(ticket_id: uuid.UUID, db: AnnDBSession, auth: AuthContext = Depends(_require_support)):
    return await _detail(db, ticket_id)


@staff_router.post("/tickets/{ticket_id}/messages", response_model=StaffMessage, status_code=201)
async def post_staff_message(
    ticket_id: uuid.UUID,
    db: AnnDBSession,
    body: str = Form("", max_length=MAX_BODY),
    note: bool = Form(False),
    image: UploadFile | None = File(None),
    auth: AuthContext = Depends(_require_support),
):
    img = await _read_image(image)
    text = _clean_body(body, img)
    ticket = await _ticket(db, ticket_id, lock=True)
    contact = await db.get(SupportContactModel, ticket.contact_id)
    message = await svc.staff_message(
        db, ticket, contact, auth.user.id, text, note=note, image=img, bot=get_bot()
    )
    return _staff_message(message, auth.user.username)


@staff_router.patch("/tickets/{ticket_id}", response_model=TicketItem)
async def update_ticket(
    ticket_id: uuid.UUID,
    body: UpdateTicketRequest,
    db: AnnDBSession,
    auth: AuthContext = Depends(_require_support),
):
    ticket = await _ticket(db, ticket_id, lock=True)
    if "assignee_id" in body.model_fields_set:
        if body.assignee_id and not await inbox.is_staff(db, body.assignee_id):
            raise ValidationError("Assignee must be staff", code=ErrorCode.SUPPORT_ASSIGNEE_INVALID)
        ticket.assignee_id = body.assignee_id
    if body.status and body.status != ticket.status:
        svc.set_status(ticket, body.status)
        try:
            async with db.begin_nested():
                await db.flush()
        except IntegrityError:
            raise ConflictError(
                "The contact already has another open ticket", code=ErrorCode.SUPPORT_TICKET_CONFLICT
            ) from None
    await db.flush()
    return _ticket_item(await inbox.ticket_row(db, ticket_id))


@staff_router.post("/tickets/{ticket_id}/read", status_code=204)
async def mark_read(ticket_id: uuid.UUID, db: AnnDBSession, auth: AuthContext = Depends(_require_support)):
    ticket = await _ticket(db, ticket_id, lock=True)
    ticket.unread_count = 0


# ---------- Telegram ----------


@telegram_router.post("/webhook", include_in_schema=False)
async def telegram_webhook(
    request: Request,
    db: AnnDBSession,
    secret: str | None = Header(None, alias="X-Telegram-Bot-Api-Secret-Token"),
):
    bot = get_bot()
    if bot is None:
        raise NotFoundError("Not found", code=ErrorCode.HTTP_ERROR)
    expected = settings.telegram_webhook_secret
    if not expected or not hmac.compare_digest((secret or "").encode(), expected.encode()):
        raise InvalidTokenError("Bad webhook secret", code=ErrorCode.TOKEN_INVALID)
    try:
        update = await request.json()
        async with db.begin_nested():
            await handle_update(db, bot, update)
    except Exception:
        # Telegram retries anything but a 2xx for hours; one broken update must not jam the queue.
        logger.exception("telegram update failed")
    return Response(status_code=200)
