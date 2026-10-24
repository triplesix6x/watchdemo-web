import asyncio
import contextlib
import hashlib
import hmac
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from APP.config import settings
from APP.constants import CrashKind, CrashStatus
from APP.entities.crash import (
    CrashFrame,
    CrashGroup,
    CrashGroupFilters,
    CrashReportDetail,
    CrashReportIn,
    CrashReportSummary,
)
from APP.exceptions import ErrorCode, NotFoundError, ValidationError
from APP.logger import AppLogger
from APP.services.release_service import UploadLike
from APP.utils_version import is_newer, is_valid
from SPI.db_adapter.repositories.crash_repo import CrashRepository

logger = AppLogger.get_logger()

EXE_NAME = "watchdemo.exe"
PDB_NAME = "watchdemo.pdb"
RETENTION = timedelta(days=90)
_SYMBOLIZER_TIMEOUT_S = 10
# Каждый запуск разбирает весь PDB: держим не больше двух сразу, чтобы поток отчётов не съел CPU.
_SYMBOLIZER_SLOTS = asyncio.Semaphore(2)
_FINGERPRINT_DEPTH = 5

_HASH = re.compile(r"::h[0-9a-f]{16}")
_ADDRESS = re.compile(r"0x[0-9a-fA-F]+")
# MSVC-имена из PDB пишут `closure$0`, rustc-демангл пишет `{closure#0}`.
_CLOSURE = re.compile(r"closure[$#]\d+")
_IN_APP = re.compile(r"^<?watchdemo(?:_lib)?::")
# Кадры паник-хука и std-обвязки над ними одинаковы у всех паник: группируем по тому, что ниже.
_PANIC_MACHINERY = (
    "std::panicking::", "core::panicking::", "std::panic::", "core::panic::",
    "rust_begin_unwind", "__rustc::rust_begin_unwind",
    "std::sys::backtrace::__rust_end_short_backtrace",
)


def normalize_function(name: str) -> str:
    return _CLOSURE.sub("closure", _ADDRESS.sub("", _HASH.sub("", name)))


def in_app_functions(symbolicated: list[dict]) -> list[str]:
    """Имена функций приложения сверху вниз, без кадров паники и инлайнов std."""
    symbols = [s for frame in symbolicated for s in frame["symbols"]]
    last_panic = max(
        (i for i, s in enumerate(symbols) if s["function"].startswith(_PANIC_MACHINERY)),
        default=-1,
    )
    return [normalize_function(s["function"]) for s in symbols[last_panic + 1:] if s["in_app"]]


def _first_js_frame(stack: str) -> str:
    lines = [line.strip() for line in stack.splitlines() if line.strip()]
    frame = next((line for line in lines if line.startswith("at ")), lines[0] if lines else "")
    return re.sub(r"\d", "", frame)


def fingerprint(report: CrashReportIn, symbolicated: list[dict] | None) -> str:
    code = report.error_code
    if report.kind == CrashKind.UNCLEAN_EXIT:
        basis = f"{code}|{report.app_version}"
    elif report.kind == CrashKind.FRONTEND:
        basis = f"{code}|{_first_js_frame(report.js_stack or report.message)}"
    else:
        names = in_app_functions(symbolicated or [])[:_FINGERPRINT_DEPTH]
        basis = "|".join([code, *names]) if names else f"{code}|{report.location or ''}"
    return hashlib.sha256(basis.encode()).hexdigest()


def crash_title(report: CrashReportIn) -> str:
    first_line = report.message.strip().splitlines()[0] if report.message.strip() else ""
    return first_line[:200] or report.error_code


def symbols_dir(version: str) -> Path:
    # Версия уже прошла semver-проверку, поэтому из каталога не выйти.
    return Path(settings.symbols.dir) / version


async def symbolicate(frames: list[CrashFrame], version: str) -> list[dict] | None:
    """Разрешает смещения кадров в функции и file:line по PDB версии.

    `None`, если символов нет или символизатор недоступен: админка тогда
    показывает сырые смещения и `location`.
    """
    own = [f for f in frames if f.module.lower() == EXE_NAME]
    exe = symbols_dir(version) / EXE_NAME
    if not own or not exe.is_file() or not (exe.parent / PDB_NAME).is_file():
        return None
    # Кадры стека — адреса возврата, они указывают за инструкцию call; -1 попадает внутрь неё.
    addresses = [hex(max(int(f.offset, 16) - 1, 0)) for f in own]
    async with _SYMBOLIZER_SLOTS:
        try:
            proc = await asyncio.create_subprocess_exec(
                settings.symbols.symbolizer, "--relative-address", "--output-style=JSON",
                f"--obj={exe}", *addresses,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
        except OSError as e:
            logger.warning(f"llvm-symbolizer unavailable: {e}")
            return None
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), _SYMBOLIZER_TIMEOUT_S)
        except TimeoutError:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            await proc.wait()
            logger.warning(f"llvm-symbolizer timed out for {version}")
            return None
    try:
        results = json.loads(out)
    except ValueError as e:
        logger.warning(f"llvm-symbolizer output for {version} is not JSON: {e!r}")
        return None
    return [
        {
            "module": frame.module,
            "offset": frame.offset,
            "symbols": [
                {
                    "function": s["FunctionName"],
                    "file": s.get("FileName") or None,
                    "line": s.get("Line") or None,
                    "column": s.get("Column") or None,
                    "in_app": bool(_IN_APP.match(s["FunctionName"])),
                }
                for s in result.get("Symbol", [])
                if s.get("FunctionName") and s["FunctionName"] != "<invalid>"
            ],
        }
        for frame, result in zip(own, results)
    ]


def hash_ip(ip: str | None) -> str | None:
    if not ip:
        return None
    return hmac.new(settings.jwt.secret.encode(), ip.encode(), hashlib.sha256).hexdigest()


async def purge_old_crash_reports(session: AsyncSession, now: datetime) -> int:
    """Удаляет отчёты старше 90 дней, группы остаются. Коммит за вызывающим."""
    return await CrashRepository(session).delete_received_before(now - RETENTION)


async def _store_upload(upload: UploadLike, dest: Path, limit_bytes: int) -> int:
    """Пишет файл во временный рядом и атомарно подменяет: повторная загрузка безопасна."""
    tmp = dest.with_name(dest.name + ".part")
    size = 0
    try:
        with tmp.open("wb") as out:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > limit_bytes:
                    raise ValidationError(
                        f"{dest.name} exceeds {settings.symbols.max_upload_mb} MB",
                        code=ErrorCode.SYMBOLS_TOO_LARGE,
                        max_upload_mb=settings.symbols.max_upload_mb,
                    )
                out.write(chunk)
        if size == 0:
            raise ValidationError(f"Empty {dest.name}", code=ErrorCode.RELEASE_EMPTY_FILE)
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)
    return size


class CrashService:
    def __init__(self, repo: CrashRepository):
        self.repo = repo

    async def ingest(
        self, report: CrashReportIn, user_id: uuid.UUID | None, ip: str | None
    ) -> uuid.UUID:
        """Сохраняет отчёт и возвращает id его группы. Повтор того же `report_id` ничего не меняет."""
        # Символизация до блокировки: медленный подпроцесс не держит ни её, ни строку группы.
        symbolicated = await symbolicate(report.frames, report.app_version)
        await self.repo.lock_report_id(report.report_id)
        if group_id := await self.repo.find_group_of_report(report.report_id):
            return group_id
        now = datetime.now(tz=timezone.utc)
        group = await self.repo.upsert_group(
            fingerprint=fingerprint(report, symbolicated),
            error_code=report.error_code,
            kind=report.kind,
            title=crash_title(report),
            app_version=report.app_version,
            now=now,
        )
        if (
            group.status == CrashStatus.RESOLVED
            and group.resolved_in_version
            and is_newer(report.app_version, group.resolved_in_version)
        ):
            await self.repo.update_group(group.id, status=CrashStatus.NEW)
        await self.repo.insert_report(
            report_id=report.report_id,
            group_id=group.id,
            user_id=user_id,
            install_id=report.install_id,
            app_version=report.app_version,
            kind=report.kind,
            error_code=report.error_code,
            occurred_at=report.occurred_at,
            received_at=now,
            ip_hash=hash_ip(ip),
            payload=report.model_dump(mode="json"),
            symbolicated=symbolicated,
        )
        return group.id

    async def list_groups(
        self, filters: CrashGroupFilters, page: int, page_size: int
    ) -> tuple[list[CrashGroup], int]:
        return await self.repo.list_groups(filters, (page - 1) * page_size, page_size)

    async def find_group_of_report(self, report_id: uuid.UUID) -> uuid.UUID | None:
        return await self.repo.find_group_of_report(report_id)

    async def get_group(self, group_id: uuid.UUID) -> tuple[CrashGroup, list[CrashReportSummary]]:
        group = await self.repo.get_group(group_id)
        if not group:
            raise NotFoundError("Crash group not found", code=ErrorCode.CRASH_GROUP_NOT_FOUND)
        return group, await self.repo.recent_reports(group_id, 50)

    async def get_report(self, report_pk: uuid.UUID) -> CrashReportDetail:
        report = await self.repo.get_report(report_pk)
        if not report:
            raise NotFoundError("Crash report not found", code=ErrorCode.CRASH_REPORT_NOT_FOUND)
        return report

    async def update_group(self, group_id: uuid.UUID, changes: dict) -> tuple[CrashGroup, CrashGroup]:
        """Правит статус, заметки и `resolved_in_version`. Возвращает (было, стало)."""
        before = await self.repo.get_group(group_id)
        if not before:
            raise NotFoundError("Crash group not found", code=ErrorCode.CRASH_GROUP_NOT_FOUND)
        if changes:
            await self.repo.update_group(group_id, **changes)
        return before, await self.repo.get_group(group_id)

    @staticmethod
    async def store_symbols(version: str, pdb: UploadLike, exe: UploadLike) -> dict[str, int]:
        if not is_valid(version):
            raise ValidationError(f"Invalid version: {version!r}", code=ErrorCode.RELEASE_BAD_VERSION)
        target = symbols_dir(version)
        target.mkdir(parents=True, exist_ok=True)
        limit = settings.symbols.max_upload_mb * 1024 * 1024
        return {
            PDB_NAME: await _store_upload(pdb, target / PDB_NAME, limit),
            EXE_NAME: await _store_upload(exe, target / EXE_NAME, limit),
        }
