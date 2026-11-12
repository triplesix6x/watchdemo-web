from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response

from APP.constants import UserRole
from APP.dependencies import Audit, AuthContext, require_role
from APP.maintenance_contract import MaintenanceNoticeSettings, PublicMaintenanceNotice
from APP.services.maintenance_service import MaintenanceService
from SPI.db_adapter.db import AnnDBSession
from SPI.db_adapter.repositories.maintenance_notice_repo import MaintenanceNoticeRepository

public_router = APIRouter(tags=["maintenance"])
admin_router = APIRouter(prefix="/admin", tags=["admin"])
_require_admin = require_role(UserRole.ADMIN)


def get_maintenance_service(db: AnnDBSession) -> MaintenanceService:
    return MaintenanceService(MaintenanceNoticeRepository(db))


AnnMaintenanceService = Annotated[MaintenanceService, Depends(get_maintenance_service)]


@public_router.get("/maintenance-notice", response_model=PublicMaintenanceNotice)
async def public_notice(
    service: AnnMaintenanceService,
    response: Response,
    locale: Literal["ru", "en"] = "ru",
):
    response.headers["Cache-Control"] = "no-store"
    return await service.public_notice(locale)


@admin_router.get("/maintenance-notice", response_model=MaintenanceNoticeSettings)
async def notice_settings(
    service: AnnMaintenanceService,
    response: Response,
    auth: AuthContext = Depends(_require_admin),
):
    response.headers["Cache-Control"] = "no-store"
    return await service.settings(auth.user)


@admin_router.patch("/maintenance-notice", response_model=MaintenanceNoticeSettings)
async def update_notice(
    body: MaintenanceNoticeSettings,
    service: AnnMaintenanceService,
    audit: Audit,
    response: Response,
    auth: AuthContext = Depends(_require_admin),
):
    notice = await service.update(auth.user, body)
    # The shared request DB dependency commits both writes, or rolls both back.
    await audit("update_maintenance_notice", details={
        "enabled": notice.enabled,
        "text_ru_length": len(notice.text_ru),
        "text_en_length": len(notice.text_en),
    })
    response.headers["Cache-Control"] = "no-store"
    return notice
