import uuid
from datetime import datetime

from sqlalchemy import String, Uuid, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from SPI.db_adapter.base_model import Base


class SubscriptionModel(Base):
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid7
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    tier: Mapped[str] = mapped_column(String(20), default="basic")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Audit field: which admin granted this subscription. No FK to avoid cascade complexity.
    granted_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)

    user: Mapped["UserModel"] = relationship(
        "UserModel",
        back_populates="subscription",
        foreign_keys=[user_id],
    )
