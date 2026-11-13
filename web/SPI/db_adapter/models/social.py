"""Provider subjects and short-lived, browser-bound authorization transactions."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from SPI.db_adapter.base_model import Base


class SocialIdentityModel(Base):
    __tablename__ = "social_identities"
    __table_args__ = (
        UniqueConstraint("provider", "subject", name="uq_social_identity_subject"),
        UniqueConstraint("user_id", "provider", name="uq_social_identity_user_provider"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(16))
    subject: Mapped[str] = mapped_column(String(255))


class DesktopSocialHandoffModel(Base):
    """Native proof and browser launch capabilities are independent, hashed and one-use."""
    __tablename__ = "desktop_social_handoffs"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid7)
    challenge_hash: Mapped[str] = mapped_column(String(64), unique=True)
    launch_hash: Mapped[str] = mapped_column(String(64), unique=True)
    provider: Mapped[str] = mapped_column(String(16))
    stage: Mapped[str] = mapped_column(String(16), default="created")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SocialTransactionModel(Base):
    __tablename__ = "social_transactions"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid7)
    desktop_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("desktop_social_handoffs.id", ondelete="CASCADE"), unique=True)
    state_hash: Mapped[str] = mapped_column(String(64), unique=True)
    browser_hash: Mapped[str] = mapped_column(String(64))
    provider: Mapped[str] = mapped_column(String(16))
    intent: Mapped[str] = mapped_column(String(16))
    stage: Mapped[str] = mapped_column(String(24), default="started")
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    session_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    verifier: Mapped[str | None] = mapped_column(String(128))
    callback: Mapped[str] = mapped_column(String(2048))
    subject: Mapped[str | None] = mapped_column(String(255))
    nonce: Mapped[str | None] = mapped_column(String(255), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
