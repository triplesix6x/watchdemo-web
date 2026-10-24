import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from SPI.db_adapter.base_model import Base


class SupportContactModel(Base):
    """Who writes to support: a site account or a Telegram user, never both (no linking)."""

    __table_args__ = (
        CheckConstraint(
            "(channel = 'web' AND user_id IS NOT NULL AND tg_user_id IS NULL)"
            " OR (channel = 'telegram' AND tg_user_id IS NOT NULL AND user_id IS NULL)",
            name="one_identity",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid7)
    channel: Mapped[str] = mapped_column(String(16))
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=True
    )
    tg_user_id: Mapped[int | None] = mapped_column(BigInteger, unique=True, nullable=True)
    tg_chat_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    tg_username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    display_name: Mapped[str] = mapped_column(String(255), default="")
    locale: Mapped[str] = mapped_column(String(5), default="ru")
    # Set when Telegram answers 403 (the user blocked the bot); any inbound message clears it.
    blocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    is_active = None
    updated_at = None


class SupportTicketModel(Base):
    __table_args__ = (
        # At most one non-closed ticket per contact; inbound routing relies on it under races.
        Index(
            "uq_support_tickets_open_contact",
            "contact_id",
            unique=True,
            postgresql_where=text("status <> 'closed'"),
        ),
        CheckConstraint("status IN ('open', 'pending', 'resolved', 'closed')", name="status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid7)
    number: Mapped[int] = mapped_column(Integer, Identity(), unique=True)
    contact_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("support_contacts.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(16), default="open")
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    unread_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    waiting_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_reply_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    is_active = None
    updated_at = None


class SupportMessageModel(Base):
    __table_args__ = (
        CheckConstraint("direction IN ('in', 'out', 'note')", name="direction"),
        CheckConstraint("delivery IS NULL OR delivery IN ('sent', 'failed')", name="delivery"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid7)
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("support_tickets.id", ondelete="CASCADE"), index=True
    )
    direction: Mapped[str] = mapped_column(String(8))
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, default="")
    # Relative to settings.support.dir: yyyy/mm/<uuid>.<ext>.
    image_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_mime: Mapped[str | None] = mapped_column(String(32), nullable=True)
    tg_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    delivery: Mapped[str | None] = mapped_column(String(8), nullable=True)
    delivery_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    is_active = None
    updated_at = None
