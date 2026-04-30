import uuid

from sqlalchemy import JSON, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from SPI.db_adapter.base_model import Base


class AuditLogModel(Base):
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid7)
    actor_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), index=True)
    action: Mapped[str] = mapped_column(String(50), index=True)
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
