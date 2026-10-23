import hashlib
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Protocol

from APP.config import settings
from APP.constants import BETA_CHANNELS, PUBLIC_CHANNELS, ReleaseChannel
from APP.entities.release import ReleaseEntity
from APP.exceptions import AlreadyExistsError, ErrorCode, NotFoundError, ValidationError
from APP.logger import AppLogger
from APP.utils_version import is_newer, is_valid

logger = AppLogger.get_logger()

_CHUNK = 1024 * 1024
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]")
# Клиент присылает target/arch из tauri-updater. Держим белый список, чтобы
# путь на диске нельзя было увести обходом каталогов.
_ALLOWED_TARGETS = {"windows", "linux", "darwin"}
_ALLOWED_ARCHS = {"x86_64", "aarch64", "i686", "armv7"}


class UploadLike(Protocol):
    """Минимум от `fastapi.UploadFile`, нужный сервису.

    Сервис не импортирует FastAPI: слой APP не должен знать про транспорт.
    """

    filename: str | None
    file: BinaryIO

    async def read(self, size: int = -1) -> bytes: ...


def safe_file_name(name: str | None, fallback: str) -> str:
    """Схлопывает имя файла до безопасного набора символов."""
    base = Path(name or "").name.strip() or fallback
    cleaned = _SAFE_NAME.sub("_", base)
    return cleaned[:255]


class ReleaseService:
    """Публикация сборок и ответ клиентскому апдейтеру.

    Файлы кладём на том, который nginx раздаёт статикой; в БД остаются
    метаданные и minisign-подпись.
    """

    def __init__(self, release_repo):
        self.release_repo = release_repo

    # ---------- Публичная часть: проверка обновления ----------

    @staticmethod
    def channels_for(is_beta_tester: bool) -> tuple[ReleaseChannel, ...]:
        return BETA_CHANNELS if is_beta_tester else PUBLIC_CHANNELS

    async def check_update(
        self,
        current_version: str,
        target: str,
        arch: str,
        is_beta_tester: bool,
    ) -> ReleaseEntity | None:
        """Находит релиз новее текущего для этого клиента.

        Args:
            current_version: Версия, с которой пришёл клиент.
            target: Платформа (`windows`).
            arch: Архитектура (`x86_64`).
            is_beta_tester: Открыт ли пользователю бета-канал.

        Returns:
            Релиз для установки либо `None`, если клиент уже актуален.
        """
        if not is_valid(current_version):
            # Битую версию считаем «неизвестно какой» и не обновляем: иначе
            # достаточно подсунуть мусор, чтобы получить ссылку на инсталлятор.
            logger.warning(f"update check with bad version: {current_version!r}")
            return None
        if target not in _ALLOWED_TARGETS or arch not in _ALLOWED_ARCHS:
            return None

        latest = await self.release_repo.get_latest(
            target=target, arch=arch, channels=self.channels_for(is_beta_tester)
        )
        if not latest:
            return None
        if not is_newer(latest.version, current_version):
            return None
        return latest

    async def latest_for(
        self, target: str, arch: str, is_beta_tester: bool
    ) -> ReleaseEntity | None:
        """Самый свежий активный релиз платформы для страницы загрузки."""
        if target not in _ALLOWED_TARGETS or arch not in _ALLOWED_ARCHS:
            return None
        return await self.release_repo.get_latest(
            target=target, arch=arch, channels=self.channels_for(is_beta_tester)
        )

    async def changelog(
        self, channel: ReleaseChannel, target: str, arch: str, limit: int
    ) -> list[ReleaseEntity]:
        """Публичный список изменений: активные релизы с `show_in_changelog`."""
        return await self.release_repo.list_changelog(channel, target, arch, limit)

    @staticmethod
    def public_url(release: ReleaseEntity) -> str:
        """Абсолютный URL инсталлятора, который nginx отдаёт статикой."""
        base = settings.releases.public_base_url.rstrip("/")
        if not base:
            frontend = settings.app.frontend_url.rstrip("/")
            base = f"{frontend}/releases"
        return f"{base}/{release.file_path}"

    # ---------- Админская часть: публикация ----------

    async def publish(
        self,
        version: str,
        channel: ReleaseChannel,
        target: str,
        arch: str,
        installer: UploadLike,
        signature: str,
        notes: str | None,
        published_by: uuid.UUID | None,
    ) -> ReleaseEntity:
        """Сохраняет инсталлятор на том и регистрирует релиз.

        Args:
            version: Версия semver, совпадающая с версией внутри сборки.
            channel: `stable` или `beta`.
            target: Платформа.
            arch: Архитектура.
            installer: Загруженный файл инсталлятора.
            signature: Содержимое `.sig`, сгенерированного `tauri signer`.
            notes: Заметки к релизу. Апдейтеру не уходят, но видны в публичном
                changelog и на странице загрузки, пока `show_in_changelog` включён.
            published_by: Кто публикует (для аудита).

        Returns:
            Созданную запись релиза.

        Raises:
            ValidationError: Некорректная версия/платформа/подпись.
            AlreadyExistsError: Такая версия под эту платформу уже есть.
        """
        version = version.strip()
        if not is_valid(version):
            raise ValidationError(
                f"Invalid version: {version!r}", code=ErrorCode.RELEASE_BAD_VERSION
            )
        if target not in _ALLOWED_TARGETS or arch not in _ALLOWED_ARCHS:
            raise ValidationError(
                f"Unknown platform: {target}/{arch}", code=ErrorCode.RELEASE_BAD_PLATFORM
            )
        signature = signature.strip()
        if not signature:
            raise ValidationError("Empty release signature", code=ErrorCode.RELEASE_BAD_SIGNATURE)

        existing = await self.release_repo.get_by_version(version, target, arch)
        if existing:
            raise AlreadyExistsError(
                f"Release {version} for {target}/{arch} is already published",
                code=ErrorCode.RELEASE_DUPLICATE,
            )

        file_name = safe_file_name(installer.filename, f"watchdemo-{version}-setup")
        rel_dir = Path(f"{target}-{arch}") / version
        abs_dir = Path(settings.releases.dir) / rel_dir
        abs_dir.mkdir(parents=True, exist_ok=True)
        abs_path = abs_dir / file_name

        size, digest = await self._store(installer, abs_path)

        return await self.release_repo.create(
            version=version,
            channel=channel,
            target=target,
            arch=arch,
            file_name=file_name,
            file_path=(rel_dir / file_name).as_posix(),
            file_size=size,
            sha256=digest,
            signature=signature,
            notes=notes,
            published_at=datetime.now(tz=timezone.utc),
            published_by=published_by,
        )

    @staticmethod
    async def _store(installer: UploadLike, dest: Path) -> tuple[int, str]:
        """Пишет загрузку на диск чанками, считая размер и sha256.

        Raises:
            ValidationError: Файл пустой или больше лимита.
        """
        limit = settings.releases.max_upload_mb * 1024 * 1024
        hasher = hashlib.sha256()
        size = 0
        try:
            with dest.open("wb") as out:
                while chunk := await installer.read(_CHUNK):
                    size += len(chunk)
                    if size > limit:
                        raise ValidationError(
                            f"Installer exceeds {settings.releases.max_upload_mb} MB",
                            code=ErrorCode.RELEASE_TOO_LARGE,
                            max_upload_mb=settings.releases.max_upload_mb,
                        )
                    hasher.update(chunk)
                    out.write(chunk)
        except Exception:
            dest.unlink(missing_ok=True)
            raise

        if size == 0:
            dest.unlink(missing_ok=True)
            raise ValidationError("Empty installer file", code=ErrorCode.RELEASE_EMPTY_FILE)
        return size, hasher.hexdigest()

    async def list_releases(
        self, page: int, page_size: int, channel: ReleaseChannel | None
    ) -> tuple[list[ReleaseEntity], int]:
        return await self.release_repo.list_paginated(
            offset=(page - 1) * page_size, limit=page_size, channel=channel
        )

    async def set_active(self, release_id: uuid.UUID, is_active: bool) -> ReleaseEntity:
        """Включает или гасит релиз.

        Raises:
            NotFoundError: Релиза с таким id нет.
        """
        release = await self.release_repo.get_by_id(release_id)
        if not release:
            raise NotFoundError("Release not found", code=ErrorCode.RELEASE_NOT_FOUND)
        await self.release_repo.set_active(release_id, is_active)
        updated = await self.release_repo.get_by_id(release_id)
        if not updated:
            raise NotFoundError("Release not found", code=ErrorCode.RELEASE_NOT_FOUND)
        return updated

    async def update(
        self, release_id: uuid.UUID, changes: dict
    ) -> ReleaseEntity:
        """Правит заметки и видимость в changelog.

        Args:
            release_id: Релиз.
            changes: Только переданные поля: `notes` (`None` очищает) и/или
                `show_in_changelog`.

        Raises:
            NotFoundError: Релиза с таким id нет.
        """
        if not await self.release_repo.get_by_id(release_id):
            raise NotFoundError("Release not found", code=ErrorCode.RELEASE_NOT_FOUND)
        await self.release_repo.update(
            release_id,
            notes=changes.get("notes"),
            show_in_changelog=changes.get("show_in_changelog"),
            set_notes="notes" in changes,
        )
        updated = await self.release_repo.get_by_id(release_id)
        if not updated:
            raise NotFoundError("Release not found", code=ErrorCode.RELEASE_NOT_FOUND)
        return updated
