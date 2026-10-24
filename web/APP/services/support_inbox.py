"""Read side of support: the staff inbox and the customer's message stream."""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import Select, and_, case, func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from APP.constants import STAFF_ROLES, Channel, Direction, TicketStatus
from SPI.db_adapter.models.support import SupportContactModel, SupportMessageModel, SupportTicketModel
from SPI.db_adapter.models.user import UserModel

# The customer stream is keyed by message id, but ids are minted before commit, so a
# message can become visible after a later one. Polls look back this far and the client
# drops ids it already has.
STREAM_OVERLAP = timedelta(seconds=30)
STREAM_FIRST_PAGE = 200


@dataclass(frozen=True)
class TicketRow:
    ticket: SupportTicketModel
    contact: SupportContactModel
    user_email: str | None
    user_name: str | None
    assignee_name: str | None
    preview: str | None
    preview_direction: str | None
    preview_has_image: bool


def _ticket_rows() -> tuple[Select, type[UserModel]]:
    user = aliased(UserModel)
    assignee = aliased(UserModel)
    last = (
        select(SupportMessageModel.body, SupportMessageModel.direction, SupportMessageModel.image_path)
        .where(SupportMessageModel.ticket_id == SupportTicketModel.id, SupportMessageModel.direction != Direction.NOTE)
        .order_by(SupportMessageModel.created_at.desc(), SupportMessageModel.id.desc())
        .limit(1)
        .lateral()
    )
    return (
        select(
            SupportTicketModel,
            SupportContactModel,
            user.email,
            user.username,
            assignee.username,
            last.c.body,
            last.c.direction,
            last.c.image_path.is_not(None),
        )
        .join(SupportContactModel, SupportContactModel.id == SupportTicketModel.contact_id)
        .outerjoin(user, user.id == SupportContactModel.user_id)
        .outerjoin(assignee, assignee.id == SupportTicketModel.assignee_id)
        .outerjoin(last, true())
    ), user


async def list_tickets(
    session: AsyncSession,
    *,
    status: TicketStatus | None,
    channel: Channel | None,
    q: str | None,
    page: int,
    page_size: int,
) -> tuple[list[TicketRow], int]:
    """Without a status, every non-closed ticket. Unread first, then the longest wait."""
    query, user = _ticket_rows()
    filters = [
        SupportTicketModel.status == status if status else SupportTicketModel.status != TicketStatus.CLOSED
    ]
    if channel:
        filters.append(SupportContactModel.channel == channel)
    if q:
        number = q.lstrip("#")
        like = f"%{q}%"
        match = or_(
            SupportContactModel.display_name.ilike(like),
            SupportContactModel.tg_username.ilike(f"%{q.lstrip('@')}%"),
            user.email.ilike(like),
            user.username.ilike(like),
        )
        filters.append(or_(match, SupportTicketModel.number == int(number)) if number.isdigit() else match)
    query = query.where(and_(*filters))
    total = await session.scalar(select(func.count()).select_from(query.subquery()))
    rows = await session.execute(
        query.order_by(
            case((SupportTicketModel.unread_count > 0, 0), else_=1),
            SupportTicketModel.waiting_since.asc().nulls_last(),
            SupportTicketModel.last_activity_at.desc(),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return [TicketRow(*r) for r in rows.all()], total or 0


async def ticket_row(session: AsyncSession, ticket_id: uuid.UUID) -> TicketRow | None:
    query, _ = _ticket_rows()
    row = (await session.execute(query.where(SupportTicketModel.id == ticket_id))).first()
    return TicketRow(*row) if row else None


async def unread_tickets(session: AsyncSession) -> int:
    return await session.scalar(
        select(func.count()).where(SupportTicketModel.unread_count > 0, SupportTicketModel.status != TicketStatus.CLOSED)
    ) or 0


async def thread(session: AsyncSession, ticket_id: uuid.UUID) -> list[tuple[SupportMessageModel, str | None]]:
    """Every message of a ticket, notes included, with the author's username."""
    rows = await session.execute(
        select(SupportMessageModel, UserModel.username)
        .outerjoin(UserModel, UserModel.id == SupportMessageModel.author_id)
        .where(SupportMessageModel.ticket_id == ticket_id)
        .order_by(SupportMessageModel.created_at, SupportMessageModel.id)
    )
    return [(m, name) for m, name in rows.all()]


async def other_tickets(session: AsyncSession, contact_id: uuid.UUID, exclude: uuid.UUID) -> list[SupportTicketModel]:
    return list(
        await session.scalars(
            select(SupportTicketModel)
            .where(SupportTicketModel.contact_id == contact_id, SupportTicketModel.id != exclude)
            .order_by(SupportTicketModel.created_at.desc())
            .limit(20)
        )
    )


async def staff_users(session: AsyncSession) -> list[tuple[uuid.UUID, str]]:
    rows = await session.execute(
        select(UserModel.id, UserModel.username)
        .where(UserModel.role.in_(STAFF_ROLES), UserModel.is_active.is_(True))
        .order_by(UserModel.username)
    )
    return [(i, n) for i, n in rows.all()]


async def customer_stream(
    session: AsyncSession, user_id: uuid.UUID, after: uuid.UUID | None
) -> list[SupportMessageModel]:
    """The user's whole web conversation across tickets, oldest first, never notes."""
    query = (
        select(SupportMessageModel)
        .join(SupportTicketModel, SupportTicketModel.id == SupportMessageModel.ticket_id)
        .join(SupportContactModel, SupportContactModel.id == SupportTicketModel.contact_id)
        .where(SupportContactModel.user_id == user_id, SupportMessageModel.direction != Direction.NOTE)
    )
    if after is None:
        newest = await session.scalars(
            query.order_by(SupportMessageModel.created_at.desc(), SupportMessageModel.id.desc()).limit(STREAM_FIRST_PAGE)
        )
        return list(reversed(newest.all()))
    anchor: datetime | None = await session.scalar(
        select(SupportMessageModel.created_at).where(SupportMessageModel.id == after)
    )
    if anchor is None:
        # An unknown id: start over rather than trust uuid7 order.
        return await customer_stream(session, user_id, None)
    query = query.where(SupportMessageModel.created_at >= anchor - STREAM_OVERLAP, SupportMessageModel.id != after)
    return list(await session.scalars(query.order_by(SupportMessageModel.created_at, SupportMessageModel.id)))


async def image_for(
    session: AsyncSession, message_id: uuid.UUID, user_id: uuid.UUID, staff: bool
) -> SupportMessageModel | None:
    """The message if it has an image this user may see: staff see all, the owner sees
    their own conversation without notes."""
    query = select(SupportMessageModel).where(
        SupportMessageModel.id == message_id, SupportMessageModel.image_path.is_not(None)
    )
    if not staff:
        query = (
            query.join(SupportTicketModel, SupportTicketModel.id == SupportMessageModel.ticket_id)
            .join(SupportContactModel, SupportContactModel.id == SupportTicketModel.contact_id)
            .where(SupportContactModel.user_id == user_id, SupportMessageModel.direction != Direction.NOTE)
        )
    return await session.scalar(query)
