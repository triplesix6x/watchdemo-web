import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from APP.constants import SubscriptionTier
from APP.services.support_service import Channel, TicketStatus


class CustomerMessage(BaseModel):
    """What the customer sees: no ticket, no status, no notes, no staff names."""

    id: uuid.UUID
    direction: Literal["in", "out"]
    body: str
    image_url: str | None
    created_at: datetime


class StaffMessage(BaseModel):
    id: uuid.UUID
    direction: Literal["in", "out", "note"]
    body: str
    image_url: str | None
    author_id: uuid.UUID | None
    author_username: str | None
    delivery: Literal["sent", "failed"] | None
    delivery_error: str | None
    edited_at: datetime | None
    created_at: datetime


class TicketItem(BaseModel):
    id: uuid.UUID
    number: int
    status: TicketStatus
    channel: Channel
    contact_name: str
    tg_username: str | None
    preview: str | None
    preview_direction: Literal["in", "out"] | None
    preview_has_image: bool
    unread_count: int
    waiting_since: datetime | None
    assignee_id: uuid.UUID | None
    assignee_username: str | None
    last_activity_at: datetime
    created_at: datetime


class TicketsPage(BaseModel):
    items: list[TicketItem]
    total: int
    page: int
    page_size: int


class ContactUser(BaseModel):
    id: uuid.UUID
    email: str
    username: str
    tier: SubscriptionTier | None


class OtherTicket(BaseModel):
    id: uuid.UUID
    number: int
    status: TicketStatus
    created_at: datetime


class ContactCard(BaseModel):
    id: uuid.UUID
    channel: Channel
    display_name: str
    locale: str
    blocked_at: datetime | None
    created_at: datetime
    # Web contacts.
    user: ContactUser | None
    # Telegram contacts.
    tg_username: str | None
    tg_user_id: int | None
    other_tickets: list[OtherTicket]


class StaffUser(BaseModel):
    id: uuid.UUID
    username: str


class TicketDetail(BaseModel):
    ticket: TicketItem
    messages: list[StaffMessage]
    contact: ContactCard
    # Who the ticket can be assigned to.
    assignees: list[StaffUser]


class UpdateTicketRequest(BaseModel):
    status: TicketStatus | None = None
    assignee_id: uuid.UUID | None = None


class UnreadResponse(BaseModel):
    tickets: int
