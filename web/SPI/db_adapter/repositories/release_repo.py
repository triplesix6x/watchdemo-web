import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import func, select

from APP.constants import ReleaseChannel
from APP.entities.release import ReleaseEntity
from APP.utils_version import InvalidVersionError, version_key
from SPI.db_adapter.base_repo import SQLAlchemyRepository
from SPI.db_adapter.models.release import ReleaseModel

# Сколько последних записей поднимаем в память, чтобы отсортировать их по
# semver. В SQL порядок semver не выразить (0.10.0 > 0.9.0 лексикографически
# наоборот), а релизов на платформу — десятки, не миллионы.
_LATEST_SCAN_LIMIT = 200


class ReleaseRepository(SQLAlchemyRepository[ReleaseModel]):
    model = ReleaseModel

    def to_entity(self, release: ReleaseModel) -> ReleaseEntity:
        return ReleaseEntity(
            id=release.id,
            version=release.version,
            channel=ReleaseChannel(release.channel),
            target=release.target,
            arch=release.arch,
            file_name=release.file_name,
            file_path=release.file_path,
            file_size=release.file_size,
            sha256=release.sha256,
            signature=release.signature,
            notes=release.notes,
            show_in_changelog=release.show_in_changelog,
            published_at=release.published_at,
            published_by=release.published_by,
            is_active=release.is_active,
            created_at=release.created_at,
            updated_at=release.updated_at,
        )

    async def get_by_id(self, release_id: uuid.UUID) -> ReleaseEntity | None:
        query = select(ReleaseModel).where(ReleaseModel.id == release_id)
        release = await self._execute_one_or_none(query)
        return self.to_entity(release) if release else None

    async def get_by_version(
        self, version: str, target: str, arch: str
    ) -> ReleaseEntity | None:
        query = select(ReleaseModel).where(
            ReleaseModel.version == version,
            ReleaseModel.target == target,
            ReleaseModel.arch == arch,
        )
        release = await self._execute_one_or_none(query)
        return self.to_entity(release) if release else None

    async def get_latest(
        self,
        target: str,
        arch: str,
        channels: Sequence[ReleaseChannel],
    ) -> ReleaseEntity | None:
        """Самый свежий по semver активный релиз в разрешённых каналах.

        Args:
            target: Платформа в терминах updater (`windows`).
            arch: Архитектура (`x86_64`).
            channels: Каналы, доступные конкретному пользователю.

        Returns:
            Релиз с максимальной версией либо `None`, если публикаций нет.
        """
        if not channels:
            return None

        query = (
            select(ReleaseModel)
            .where(
                ReleaseModel.is_active.is_(True),
                ReleaseModel.target == target,
                ReleaseModel.arch == arch,
                ReleaseModel.channel.in_([c.value for c in channels]),
            )
            .order_by(ReleaseModel.published_at.desc())
            .limit(_LATEST_SCAN_LIMIT)
        )
        rows = await self._execute_all(query)

        best: ReleaseModel | None = None
        best_key = None
        for row in rows:
            try:
                key = version_key(row.version)
            except InvalidVersionError:
                # Мусорная версия не должна ронять выдачу всем клиентам.
                continue
            if best_key is None or key > best_key:
                best, best_key = row, key
        return self.to_entity(best) if best else None

    async def create(
        self,
        version: str,
        channel: ReleaseChannel,
        target: str,
        arch: str,
        file_name: str,
        file_path: str,
        file_size: int,
        sha256: str,
        signature: str,
        notes: str | None,
        published_at: datetime,
        published_by: uuid.UUID | None,
    ) -> ReleaseEntity:
        release = ReleaseModel(
            version=version,
            channel=channel.value,
            target=target,
            arch=arch,
            file_name=file_name,
            file_path=file_path,
            file_size=file_size,
            sha256=sha256,
            signature=signature,
            notes=notes,
            published_at=published_at,
            published_by=published_by,
        )
        self.session.add(release)
        await self.session.flush()
        await self.session.refresh(release)
        return self.to_entity(release)

    async def set_active(self, release_id: uuid.UUID, is_active: bool) -> None:
        query = select(ReleaseModel).where(ReleaseModel.id == release_id).with_for_update()
        release = await self._execute_one_or_none(query)
        if release:
            release.is_active = is_active
            await self.session.flush()

    async def list_paginated(
        self,
        offset: int,
        limit: int,
        channel: ReleaseChannel | None = None,
    ) -> tuple[list[ReleaseEntity], int]:
        """Страница публикаций для админки, свежие сверху."""
        conds = []
        if channel is not None:
            conds.append(ReleaseModel.channel == channel.value)

        list_query = select(ReleaseModel)
        count_query = select(func.count()).select_from(ReleaseModel)
        if conds:
            list_query = list_query.where(*conds)
            count_query = count_query.where(*conds)

        list_query = (
            list_query.order_by(ReleaseModel.published_at.desc()).offset(offset).limit(limit)
        )
        rows = await self._execute_all(list_query)
        total = (await self.session.execute(count_query)).scalar_one()
        return [self.to_entity(r) for r in rows], total

    async def update(
        self,
        release_id: uuid.UUID,
        notes: str | None,
        show_in_changelog: bool | None,
        set_notes: bool,
    ) -> None:
        """Правит заметки и видимость в changelog.

        `set_notes` отличает «очистить заметки» (`notes=None`) от «не трогать».
        """
        query = select(ReleaseModel).where(ReleaseModel.id == release_id).with_for_update()
        release = await self._execute_one_or_none(query)
        if not release:
            return
        if set_notes:
            release.notes = notes
        if show_in_changelog is not None:
            release.show_in_changelog = show_in_changelog
        await self.session.flush()

    async def list_changelog(
        self, channel: ReleaseChannel, target: str, arch: str, limit: int
    ) -> list[ReleaseEntity]:
        """Активные релизы канала, отмеченные для публичного changelog, свежие сверху."""
        query = (
            select(ReleaseModel)
            .where(
                ReleaseModel.is_active.is_(True),
                ReleaseModel.show_in_changelog.is_(True),
                ReleaseModel.channel == channel.value,
                ReleaseModel.target == target,
                ReleaseModel.arch == arch,
            )
            .order_by(ReleaseModel.published_at.desc())
            .limit(limit)
        )
        return [self.to_entity(r) for r in await self._execute_all(query)]
