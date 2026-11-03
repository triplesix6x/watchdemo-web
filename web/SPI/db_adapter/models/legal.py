"""Legal records are independent of account cascade/anonymization.

The migration also protects published snapshots/activations and unexpired evidence
against mutation in SQL, not just through the ORM.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Integer, String, UniqueConstraint, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from SPI.db_adapter.base_model import Base


class LegalDocumentSnapshotModel(Base):
    __tablename__ = "legal_document_snapshots"
    __table_args__ = (UniqueConstraint("document_id", "revision", "sha256"),)

    document_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    revision: Mapped[str] = mapped_column(String(100), primary_key=True)
    sha256: Mapped[str] = mapped_column(String(64))
    document: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    is_active = None
    updated_at = None


class LegalActivationModel(Base):
    __tablename__ = "legal_activations"
    __table_args__ = (CheckConstraint("sequence > 0", name="positive_sequence"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    sequence: Mapped[int] = mapped_column(Integer, unique=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    catalog_sha256: Mapped[str] = mapped_column(String(64))
    release: Mapped[dict] = mapped_column(JSONB)
    documents: Mapped[list] = mapped_column(JSONB)
    # Also the notification eligibility cutoff; sampled after taking the policy lock.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_active = None
    updated_at = None


class LegalAcceptanceModel(Base):
    __tablename__ = "legal_acceptances"
    __table_args__ = (
        ForeignKeyConstraint(
            ["document_id", "revision", "sha256"],
            ["legal_document_snapshots.document_id", "legal_document_snapshots.revision", "legal_document_snapshots.sha256"],
        ),
        CheckConstraint("action = 'accept_terms'", name="accept_terms_action"),
        CheckConstraint("retain_until > created_at", name="positive_retention"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Intentionally not a users FK: even a hard account delete must not erase evidence.
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    activation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("legal_activations.id"))
    document_id: Mapped[str] = mapped_column(String(16))
    revision: Mapped[str] = mapped_column(String(100))
    sha256: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(24), default="accept_terms")
    locale: Mapped[str] = mapped_column(String(5))
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    retain_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    is_active = None
    updated_at = None


class LegalNotificationModel(Base):
    __tablename__ = "legal_notifications"
    __table_args__ = (
        UniqueConstraint("user_id", "document_id", "revision"),
        ForeignKeyConstraint(
            ["document_id", "revision"],
            ["legal_document_snapshots.document_id", "legal_document_snapshots.revision"],
        ),
        CheckConstraint("status IN ('pending', 'published', 'suppressed')", name="notification_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    activation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("legal_activations.id"))
    document_id: Mapped[str] = mapped_column(String(16))
    revision: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active = None
    updated_at = None
