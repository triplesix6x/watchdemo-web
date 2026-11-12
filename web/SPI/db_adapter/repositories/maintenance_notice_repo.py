from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from APP.maintenance_contract import MaintenanceNoticeSettings
from SPI.db_adapter.models.maintenance_notice import MaintenanceNoticeModel


class MaintenanceNoticeRepository:
    """One row; reads never create a setting or commit a transaction."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self) -> MaintenanceNoticeSettings:
        row = await self.session.scalar(select(MaintenanceNoticeModel).where(MaintenanceNoticeModel.id == 1))
        if row is None:
            return MaintenanceNoticeSettings()
        return MaintenanceNoticeSettings(enabled=row.enabled, text_ru=row.text_ru, text_en=row.text_en)

    async def save(self, notice: MaintenanceNoticeSettings) -> MaintenanceNoticeSettings:
        values = notice.model_dump()
        statement = insert(MaintenanceNoticeModel).values(id=1, **values)
        # Atomic upsert also handles two administrators saving the first draft.
        await self.session.execute(statement.on_conflict_do_update(
            index_elements=[MaintenanceNoticeModel.id],
            set_={**values, "updated_at": func.now()},
        ))
        await self.session.flush()
        return notice
