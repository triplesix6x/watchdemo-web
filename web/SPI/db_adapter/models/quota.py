"""Opaque account quota metadata; never local names, paths or content."""
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from SPI.db_adapter.base_model import Base


class QuotaAccountModel(Base):
    __tablename__ = "quota_accounts"
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    group_generation: Mapped[int] = mapped_column(Integer, default=0)


class QuotaLibraryModel(Base):
    __tablename__ = "quota_libraries"
    library_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    reconciled_generation: Mapped[int] = mapped_column(Integer, default=-1)


class UsageOperationModel(Base):
    __tablename__ = "usage_operations"
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    operation_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    library_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("quota_libraries.library_id"), index=True)
    kind: Mapped[str | None] = mapped_column(String(20), nullable=True)
    state: Mapped[str] = mapped_column(String(16))
    reserved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    paid_cycle_anchor: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    group_generation: Mapped[int] = mapped_column(Integer, default=0)
    # Tombstones survive reset/reconcile; old identities cannot resurrect grants.
    group_deleted: Mapped[bool] = mapped_column(default=False)
    __table_args__ = (
        CheckConstraint("kind IN ('demo_import', 'custom_sets', 'demo_groups')", name="usage_kind"),
        CheckConstraint("state IN ('reserved', 'committed', 'cancelled', 'expired')", name="usage_state"),
        CheckConstraint("kind IS NOT NULL OR state = 'cancelled'", name="cancel_tombstone_kind"),
        Index("ix_usage_account_kind_time", "user_id", "kind", "reserved_at"),
    )
