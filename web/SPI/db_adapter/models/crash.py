import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from SPI.db_adapter.base_model import Base


class CrashGroupModel(Base):
    """Группа одинаковых падений: статус разбора живёт здесь, а не на отчёте."""

    __table_args__ = (
        CheckConstraint("status IN ('new', 'in_progress', 'resolved')", name="status"),
        Index("ix_crash_groups_status_last_seen", "status", "last_seen"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid7)
    fingerprint: Mapped[str] = mapped_column(Text, unique=True)
    error_code: Mapped[str] = mapped_column(String(32), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="new", server_default="new")
    resolved_in_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    report_count: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    last_app_version: Mapped[str] = mapped_column(String(64))


class CrashReportModel(Base):
    __table_args__ = (
        Index("ix_crash_reports_group_id_received_at", "group_id", "received_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid7)
    # Ключ идемпотентности от клиента: повторная отправка не создаёт второй отчёт.
    report_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), unique=True)
    group_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("crash_groups.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    install_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True))
    app_version: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16))
    error_code: Mapped[str] = mapped_column(String(32))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    symbolicated: Mapped[list | None] = mapped_column(JSONB, nullable=True)
