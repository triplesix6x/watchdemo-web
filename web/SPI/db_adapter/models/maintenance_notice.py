from sqlalchemy import CheckConstraint, Integer, String, false
from sqlalchemy.orm import Mapped, mapped_column

from SPI.db_adapter.base_model import Base


class MaintenanceNoticeModel(Base):
    __tablename__ = "maintenance_notices"
    __table_args__ = (
        CheckConstraint("id = 1", name="maintenance_notice_singleton"),
        CheckConstraint("NOT enabled OR length(trim(text_ru)) > 0", name="maintenance_notice_russian"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    enabled: Mapped[bool] = mapped_column(default=False, server_default=false())
    text_ru: Mapped[str] = mapped_column(String(500), default="", server_default="")
    text_en: Mapped[str] = mapped_column(String(500), default="", server_default="")
