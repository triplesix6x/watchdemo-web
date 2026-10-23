import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, String, Text, UniqueConstraint, Uuid, true
from sqlalchemy.orm import Mapped, mapped_column

from SPI.db_adapter.base_model import Base


class ReleaseModel(Base):
    """Опубликованная сборка десктопного приложения.

    `is_active` из базовой модели работает аварийным рубильником: снятый
    флаг мгновенно убирает релиз из выдачи, и клиенты, ещё не успевшие
    обновиться, остаются на предыдущей версии.
    """

    __table_args__ = (
        UniqueConstraint(
            "version", "target", "arch", name="uq_releases_version_target_arch"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid7
    )
    version: Mapped[str] = mapped_column(String(64), index=True)
    channel: Mapped[str] = mapped_column(String(16), default="stable", index=True)
    # Пара target/arch в терминах tauri-updater: `windows` + `x86_64`.
    target: Mapped[str] = mapped_column(String(32), default="windows", index=True)
    arch: Mapped[str] = mapped_column(String(32), default="x86_64", index=True)

    file_name: Mapped[str] = mapped_column(String(255))
    # Путь относительно settings.releases.dir — том можно перемонтировать.
    file_path: Mapped[str] = mapped_column(String(512))
    file_size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    # Содержимое .sig от minisign. Клиент проверяет им скачанный файл.
    signature: Mapped[str] = mapped_column(Text)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Показывать ли релиз в публичном «Что нового». Выдачу апдейтеру не трогает.
    show_in_changelog: Mapped[bool] = mapped_column(default=True, server_default=true())
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    published_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), nullable=True
    )
