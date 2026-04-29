import uuid

from sqlalchemy import String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from SPI.db_adapter.base_model import Base


class UserModel(Base):
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid7
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="user", index=True)
    is_verified: Mapped[bool] = mapped_column(default=False)

    sessions: Mapped[list["SessionModel"]] = relationship(
        "SessionModel", back_populates="user", cascade="all, delete-orphan"
    )
    subscription: Mapped["SubscriptionModel | None"] = relationship(
        "SubscriptionModel",
        back_populates="user",
        uselist=False,
        foreign_keys="SubscriptionModel.user_id",
    )
    one_time_tokens: Mapped[list["OneTimeTokenModel"]] = relationship(
        "OneTimeTokenModel", back_populates="user", cascade="all, delete-orphan"
    )
