import uuid
from datetime import datetime

from sqlalchemy import delete, exists, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from APP.constants import CrashStatus
from APP.entities.crash import CrashGroup, CrashGroupFilters, CrashReportDetail, CrashReportSummary
from SPI.db_adapter.models.crash import CrashGroupModel, CrashReportModel
from SPI.db_adapter.models.user import UserModel

# Двухключевой advisory lock живёт в своём пространстве и не пересекается с локом периодической задачи.
_LOCK_NAMESPACE = 0x63726173  # "cras"
_GROUP_COLUMNS = [getattr(CrashGroupModel, f) for f in CrashGroup.model_fields]
_SUMMARY_COLUMNS = [
    *(getattr(CrashReportModel, f) for f in CrashReportSummary.model_fields if f != "user_email"),
    UserModel.email.label("user_email"),
]


class CrashRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def lock_report_id(self, report_id: uuid.UUID) -> None:
        """Сериализует параллельные повторы одного отчёта до конца транзакции."""
        key = int.from_bytes(report_id.bytes[:4], "big", signed=True)
        await self.session.execute(select(func.pg_advisory_xact_lock(_LOCK_NAMESPACE, key)))

    async def find_group_of_report(self, report_id: uuid.UUID) -> uuid.UUID | None:
        return await self.session.scalar(
            select(CrashReportModel.group_id).where(CrashReportModel.report_id == report_id)
        )

    async def upsert_group(
        self, fingerprint: str, error_code: str, kind: str, title: str, app_version: str,
        now: datetime,
    ) -> CrashGroup:
        """Создаёт группу или засчитывает в неё ещё один отчёт. Строка остаётся под блокировкой."""
        stmt = insert(CrashGroupModel).values(
            id=uuid.uuid7(), fingerprint=fingerprint, error_code=error_code, kind=kind,
            title=title, status=CrashStatus.NEW, first_seen=now, last_seen=now, report_count=1,
            last_app_version=app_version, is_active=True,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[CrashGroupModel.fingerprint],
            set_={
                "last_seen": now,
                "report_count": CrashGroupModel.report_count + 1,
                "last_app_version": app_version,
                "updated_at": func.now(),
            },
        ).returning(*_GROUP_COLUMNS)
        row = (await self.session.execute(stmt)).one()
        return CrashGroup.model_validate(row._mapping)

    async def insert_report(self, **values) -> None:
        await self.session.execute(
            insert(CrashReportModel)
            .values(id=uuid.uuid7(), is_active=True, **values)
            .on_conflict_do_nothing(index_elements=[CrashReportModel.report_id])
        )

    async def list_groups(
        self, filters: CrashGroupFilters, offset: int, limit: int
    ) -> tuple[list[CrashGroup], int]:
        g = CrashGroupModel
        conds = []
        if filters.status:
            conds.append(g.status == filters.status)
        if filters.kind:
            conds.append(g.kind == filters.kind)
        if filters.error_code:
            conds.append(g.error_code == filters.error_code)
        if filters.version:
            conds.append(
                exists().where(
                    CrashReportModel.group_id == g.id,
                    CrashReportModel.app_version == filters.version,
                )
            )
        if filters.date_from:
            conds.append(g.last_seen >= filters.date_from)
        if filters.date_to:
            conds.append(g.last_seen < filters.date_to)
        order = g.report_count.desc() if filters.sort == "count" else g.last_seen.desc()
        total = await self.session.scalar(select(func.count()).select_from(g).where(*conds))
        rows = await self.session.execute(
            select(*_GROUP_COLUMNS).where(*conds).order_by(order, g.id.desc())
            .offset(offset).limit(limit)
        )
        return [CrashGroup.model_validate(r._mapping) for r in rows], total or 0

    async def get_group(self, group_id: uuid.UUID) -> CrashGroup | None:
        row = (await self.session.execute(
            select(*_GROUP_COLUMNS).where(CrashGroupModel.id == group_id)
        )).one_or_none()
        return CrashGroup.model_validate(row._mapping) if row else None

    async def recent_reports(self, group_id: uuid.UUID, limit: int) -> list[CrashReportSummary]:
        rows = await self.session.execute(
            select(*_SUMMARY_COLUMNS)
            .outerjoin(UserModel, UserModel.id == CrashReportModel.user_id)
            .where(CrashReportModel.group_id == group_id)
            .order_by(CrashReportModel.received_at.desc(), CrashReportModel.id.desc())
            .limit(limit)
        )
        return [CrashReportSummary.model_validate(r._mapping) for r in rows]

    async def get_report(self, report_pk: uuid.UUID) -> CrashReportDetail | None:
        row = (await self.session.execute(
            select(
                *_SUMMARY_COLUMNS, CrashReportModel.group_id, CrashReportModel.payload,
                CrashReportModel.symbolicated,
            )
            .outerjoin(UserModel, UserModel.id == CrashReportModel.user_id)
            .where(CrashReportModel.id == report_pk)
        )).one_or_none()
        return CrashReportDetail.model_validate(row._mapping) if row else None

    async def update_group(self, group_id: uuid.UUID, **values) -> None:
        await self.session.execute(
            update(CrashGroupModel).where(CrashGroupModel.id == group_id)
            .values(**values, updated_at=func.now())
        )

    async def delete_received_before(self, cutoff: datetime) -> int:
        result = await self.session.execute(
            delete(CrashReportModel).where(CrashReportModel.received_at < cutoff)
        )
        return result.rowcount
