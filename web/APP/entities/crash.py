import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, model_validator

from APP.constants import CrashKind, CrashStatus
from APP.utils_version import version_key


def _semver(v: str) -> str:
    version_key(v)
    return v.strip()


SemVer = Annotated[str, Field(max_length=64), AfterValidator(_semver)]


class CrashFrame(BaseModel):
    module: str = Field(max_length=260)
    offset: str = Field(pattern=r"^0x[0-9a-fA-F]{1,16}$")


class Breadcrumb(BaseModel):
    ts: datetime
    category: str = Field(max_length=32)
    message: str = Field(max_length=1024)


def _postgres_safe(value):
    """Убирает NUL: Postgres не примет его ни в text, ни в jsonb.

    Хвост лога после сбоя питания часто кончается нулевыми байтами.
    """
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, list):
        return [_postgres_safe(v) for v in value]
    if isinstance(value, dict):
        return {k: _postgres_safe(v) for k, v in value.items()}
    return value


class CrashReportIn(BaseModel):
    """Отчёт о падении от десктопного приложения (SPEC 2.5).

    Неизвестные поля молча отбрасываем: новое приложение не должно ломаться
    о старый сервер. Неизвестный `kind` даёт 422.
    """

    report_id: uuid.UUID
    kind: CrashKind
    error_code: str = Field(max_length=32)
    message: str = Field(max_length=4096)
    location: str | None = Field(None, max_length=1024)
    frames: list[CrashFrame] = Field(default_factory=list, max_length=128)
    js_stack: str | None = Field(None, max_length=32 * 1024)
    app_version: SemVer
    os_version: str = Field(max_length=128)
    webview_version: str | None = Field(None, max_length=64)
    locale: str = Field(max_length=16)
    install_id: uuid.UUID
    session_id: uuid.UUID
    occurred_at: datetime
    breadcrumbs: list[Breadcrumb] = Field(default_factory=list, max_length=100)
    log_tail: str = Field("", max_length=256 * 1024)
    user_comment: str | None = Field(None, max_length=2000)

    @model_validator(mode="before")
    @classmethod
    def _clean(cls, data):
        return _postgres_safe(data)


class SymbolicatedFrame(BaseModel):
    """Один кадр `frames`; `symbols` — цепочка инлайнов, самый вложенный первым."""

    module: str
    offset: str
    symbols: list[dict]


class CrashGroup(BaseModel):
    id: uuid.UUID
    fingerprint: str
    error_code: str
    kind: CrashKind
    title: str
    status: CrashStatus
    resolved_in_version: str | None
    notes: str | None
    first_seen: datetime
    last_seen: datetime
    report_count: int
    last_app_version: str


class CrashReportSummary(BaseModel):
    id: uuid.UUID
    report_id: uuid.UUID
    user_id: uuid.UUID | None
    user_email: str | None
    install_id: uuid.UUID
    app_version: str
    kind: CrashKind
    error_code: str
    occurred_at: datetime
    received_at: datetime


class CrashReportDetail(CrashReportSummary):
    group_id: uuid.UUID
    payload: dict
    symbolicated: list[SymbolicatedFrame] | None


@dataclass(frozen=True)
class CrashGroupFilters:
    status: CrashStatus | None = None
    kind: CrashKind | None = None
    error_code: str | None = None
    version: str | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None
    sort: Literal["last_seen", "count"] = "last_seen"
