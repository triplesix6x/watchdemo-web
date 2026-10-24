import uuid
import zlib
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field
from pydantic import ValidationError as PydanticValidationError

from APP.constants import CrashKind, CrashStatus, UserRole
from APP.dependencies import Audit, AuthContext, OptionalUser, require_role
from APP.entities.crash import (
    CrashGroup,
    CrashGroupFilters,
    CrashReportDetail,
    CrashReportIn,
    CrashReportSummary,
    SemVer,
)
from APP.exceptions import ErrorCode, PayloadTooLargeError, RateLimitedError, ValidationError
from APP.rate_limiter import client_ip, crash_install_limiter, crash_ip_limiter
from APP.services.crash_service import CrashService
from SPI.db_adapter.db import AnnDBSession
from SPI.db_adapter.repositories.crash_repo import CrashRepository

router = APIRouter(tags=["crash"])

_require_admin = require_role(UserRole.ADMIN)
WIRE_LIMIT = 1024 * 1024
JSON_LIMIT = 3 * 1024 * 1024


def get_crash_service(db: AnnDBSession) -> CrashService:
    return CrashService(CrashRepository(db))


AnnCrashService = Annotated[CrashService, Depends(get_crash_service)]


def _too_large(what: str, limit: int) -> PayloadTooLargeError:
    return PayloadTooLargeError(
        f"Crash report {what} exceeds {limit} bytes",
        code=ErrorCode.CRASH_PAYLOAD_TOO_LARGE, limit_bytes=limit,
    )


async def _read_body(request: Request) -> bytes:
    """Тело с лимитом 1 МБ на проводе и 3 МБ после gzip; распаковка обрывается на лимите."""
    wire = bytearray()
    async for chunk in request.stream():
        wire += chunk
        if len(wire) > WIRE_LIMIT:
            raise _too_large("body", WIRE_LIMIT)
    if request.headers.get("content-encoding", "").lower() != "gzip":
        return bytes(wire)
    inflater = zlib.decompressobj(wbits=31)
    try:
        body = inflater.decompress(bytes(wire), JSON_LIMIT + 1)
    except zlib.error:
        raise ValidationError("Body is not valid gzip", code=ErrorCode.CRASH_BAD_ENCODING)
    if len(body) > JSON_LIMIT:
        raise _too_large("JSON", JSON_LIMIT)
    if not inflater.eof:
        raise ValidationError("Truncated gzip body", code=ErrorCode.CRASH_BAD_ENCODING)
    return body


class CrashReportAccepted(BaseModel):
    report_id: uuid.UUID
    group_id: uuid.UUID


@router.post("/crash-reports", status_code=202, response_model=CrashReportAccepted)
async def ingest_crash_report(
    request: Request, service: AnnCrashService, user: OptionalUser
) -> CrashReportAccepted:
    """Принимает отчёт из диалога падения. Без токена или с битым токеном — анонимно, не 401."""
    raw = await _read_body(request)
    try:
        report = CrashReportIn.model_validate_json(raw)
    except PydanticValidationError as e:
        raise RequestValidationError(e.errors(include_url=False, include_context=False))
    # Повтор уже принятого отчёта отвечает тем же 202 и лимит не тратит.
    if group_id := await service.find_group_of_report(report.report_id):
        return CrashReportAccepted(report_id=report.report_id, group_id=group_id)
    ip = client_ip(request)
    for limiter, key in ((crash_ip_limiter, ip or "unknown"), (crash_install_limiter, str(report.install_id))):
        if not await limiter.is_allowed(key):
            message = "Too many crash reports"
            raise RateLimitedError(message, code=ErrorCode.RATE_LIMITED, detail=message)
    group_id = await service.ingest(report, user.id if user else None, ip)
    return CrashReportAccepted(report_id=report.report_id, group_id=group_id)


class CrashGroupsPage(BaseModel):
    items: list[CrashGroup]
    total: int
    page: int
    page_size: int


class CrashGroupDetail(CrashGroup):
    reports: list[CrashReportSummary]


class UpdateCrashGroupRequest(BaseModel):
    # Поле можно опустить, но не обнулить: explicit null даёт 422.
    status: CrashStatus = None  # type: ignore[assignment]
    notes: str | None = Field(None, max_length=10_000)
    resolved_in_version: SemVer | None = None


def _day_start(d: date | None, shift_days: int = 0) -> datetime | None:
    if d is None:
        return None
    return datetime.combine(d + timedelta(days=shift_days), time.min, tzinfo=timezone.utc)


@router.get("/admin/crashes", response_model=CrashGroupsPage)
async def list_crash_groups(
    service: AnnCrashService,
    status: CrashStatus | None = None,
    kind: CrashKind | None = None,
    error_code: str | None = Query(None, max_length=32),
    version: str | None = Query(None, max_length=64),
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    sort: Literal["last_seen", "count"] = "last_seen",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    auth: AuthContext = Depends(_require_admin),
):
    filters = CrashGroupFilters(
        status=status, kind=kind, error_code=error_code or None, version=version or None,
        date_from=_day_start(date_from),
        # `to` включительно: до начала следующего дня.
        date_to=_day_start(date_to, 1), sort=sort,
    )
    items, total = await service.list_groups(filters, page, page_size)
    return CrashGroupsPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/admin/crashes/reports/{report_id}", response_model=CrashReportDetail)
async def get_crash_report(
    report_id: uuid.UUID, service: AnnCrashService, auth: AuthContext = Depends(_require_admin)
):
    return await service.get_report(report_id)


@router.get("/admin/crashes/{group_id}", response_model=CrashGroupDetail)
async def get_crash_group(
    group_id: uuid.UUID, service: AnnCrashService, auth: AuthContext = Depends(_require_admin)
):
    group, reports = await service.get_group(group_id)
    return CrashGroupDetail(**group.model_dump(), reports=reports)


@router.patch("/admin/crashes/{group_id}", response_model=CrashGroup)
async def update_crash_group(
    group_id: uuid.UUID,
    body: UpdateCrashGroupRequest,
    service: AnnCrashService,
    audit: Audit,
    auth: AuthContext = Depends(_require_admin),
):
    changes = body.model_dump(exclude_unset=True)
    before, after = await service.update_group(group_id, changes)
    if before.status != after.status:
        await audit(
            "crash_group_status",
            details={"group_id": str(group_id), "from": before.status, "to": after.status},
        )
    return after


@router.post("/admin/releases/{version}/symbols", status_code=201)
async def upload_symbols(
    version: str,
    audit: Audit,
    pdb: UploadFile = File(...),
    exe: UploadFile = File(...),
    auth: AuthContext = Depends(_require_admin),
) -> dict[str, int]:
    """PDB и exe релиза для символизации. Повторная загрузка той же версии заменяет файлы."""
    sizes = await CrashService.store_symbols(version.strip(), pdb, exe)
    await audit("upload_symbols", details={"version": version.strip(), **sizes})
    return sizes
