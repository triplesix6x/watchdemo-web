from APP.constants import UserRole
from APP.entities.user import UserEntity
from APP.exceptions import ErrorCode, PermissionDeniedError
from APP.maintenance_contract import MaintenanceNoticeSettings, PublicMaintenanceNotice
from SPI.db_adapter.repositories.maintenance_notice_repo import MaintenanceNoticeRepository


class MaintenanceService:
    def __init__(self, repository: MaintenanceNoticeRepository) -> None:
        self.repository = repository

    async def public_notice(self, locale: str) -> PublicMaintenanceNotice:
        notice = await self.repository.get()
        text = ""
        if notice.enabled:
            text = (notice.text_en or notice.text_ru) if locale == "en" else notice.text_ru
        return PublicMaintenanceNotice(enabled=notice.enabled, text=text)

    @staticmethod
    def _require_admin(actor: UserEntity) -> None:
        if UserRole(actor.role) is not UserRole.ADMIN:
            raise PermissionDeniedError("Insufficient permissions", code=ErrorCode.INSUFFICIENT_ROLE)

    async def settings(self, actor: UserEntity) -> MaintenanceNoticeSettings:
        self._require_admin(actor)
        return await self.repository.get()

    async def update(self, actor: UserEntity, notice: MaintenanceNoticeSettings) -> MaintenanceNoticeSettings:
        self._require_admin(actor)
        # Revalidate even when called directly rather than through the HTTP schema.
        validated = MaintenanceNoticeSettings.model_validate(notice.model_dump())
        return await self.repository.save(validated)
