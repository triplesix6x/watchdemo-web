"""Crash ingestion and triage.

Pure fingerprint tests always run. HTTP tests need a real Postgres from
`POSTGRES__*` (they migrate it to head and truncate tables) and skip without one.
The symbolication test also needs `SYMBOLS__SYMBOLIZER` and `CRASH_TEST_BUILD`,
a directory with a release `watchdemo.exe`, `watchdemo.pdb` and the `crash.json`
it printed.
"""

import gzip
import json
import os
import re
import sys
import socket
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

import APP.dependencies as deps
from APP.config import settings
from APP.entities.crash import CrashReportIn
from APP.services import crash_service
from APP.services.crash_service import fingerprint, in_app_functions

WEB = Path(__file__).resolve().parents[1]


def _report(**kw) -> dict:
    base = {
        "report_id": str(uuid.uuid4()),
        "kind": "panic",
        "error_code": "WD-CORE-001",
        "message": "called `Option::unwrap()` on a `None` value",
        "location": "src\\services\\analysis.rs:12:5",
        "frames": [{"module": "watchdemo.exe", "offset": "0x1a2b3c"}],
        "js_stack": None,
        "app_version": "0.8.1",
        "os_version": "Windows 11 26100",
        "webview_version": "130.0.2849.80",
        "locale": "ru",
        "install_id": str(uuid.uuid4()),
        "session_id": str(uuid.uuid4()),
        "occurred_at": "2026-10-24T10:00:00Z",
        "breadcrumbs": [{"ts": "2026-10-24T09:59:59Z", "category": "ipc", "message": "list_demos"}],
        "log_tail": "INFO started\n",
        "user_comment": None,
    }
    return base | kw


def _symbols(*names: str) -> list[dict]:
    return [
        {"module": "watchdemo.exe", "offset": "0x1",
         "symbols": [{"function": n, "in_app": bool(re.match(r"<?watchdemo(_lib)?::", n))}]}
        for n in names
    ]


# ---------- Fingerprint ----------

def test_fingerprint_uses_top_five_in_app_functions_below_the_panic():
    stack = _symbols(
        "watchdemo_lib::adapters::observability::crash::install::closure$0",
        "std::panicking::panic_with_hook",
        "core::panicking::panic_fmt",
        "core::option::unwrap_failed",
        "watchdemo_lib::services::analysis::parse::h0123456789abcdef",
        "watchdemo_lib::services::analysis::run::closure$3",
        "<watchdemo_lib::X as core::ops::Drop>::drop",
        "tauri::ipc::invoke",
        "watchdemo_lib::a", "watchdemo_lib::b", "watchdemo_lib::c",
    )
    assert in_app_functions(stack) == [
        "watchdemo_lib::services::analysis::parse",
        "watchdemo_lib::services::analysis::run::closure",
        "<watchdemo_lib::X as core::ops::Drop>::drop",
        "watchdemo_lib::a", "watchdemo_lib::b", "watchdemo_lib::c",
    ]
    report = CrashReportIn.model_validate(_report())
    rebuilt = _symbols(
        "std::panicking::begin_panic",
        "watchdemo_lib::services::analysis::parse::hfedcba9876543210",
        "watchdemo_lib::services::analysis::run::closure$7",
        "<watchdemo_lib::X as core::ops::Drop>::drop",
        "watchdemo_lib::a", "watchdemo_lib::b", "watchdemo_lib::other_sixth",
    )
    assert fingerprint(report, stack) == fingerprint(report, rebuilt)
    assert fingerprint(report, stack) != fingerprint(report, _symbols("watchdemo_lib::a"))


def test_fingerprint_fallbacks():
    def fp(**kw):
        return fingerprint(CrashReportIn.model_validate(_report(**kw)), None)

    assert fp(location="a.rs:1:1") == fp(location="a.rs:1:1", frames=[])
    assert fp(location="a.rs:1:1") != fp(location="a.rs:2:1")
    # No in-app names in the stack falls back to location too.
    report = CrashReportIn.model_validate(_report(location="a.rs:1:1"))
    assert fingerprint(report, _symbols("std::rt::lang_start")) == fp(location="a.rs:1:1")

    unclean = {"kind": "unclean_exit", "error_code": "WD-CORE-002", "frames": [], "location": None}
    assert fp(**unclean) == fp(**unclean, message="other log")
    assert fp(**unclean) != fp(**unclean, app_version="0.8.2")

    front = {"kind": "frontend", "error_code": "WD-UI-001", "frames": []}
    s1 = "TypeError: x is undefined\n    at render (index-a1b2.js:10:5)\n    at other (x.js:1:1)"
    s2 = "TypeError: y is undefined\n    at render (index-a9b8.js:77:12)"
    assert fp(**front, js_stack=s1) == fp(**front, js_stack=s2)
    assert fp(**front, js_stack=s1) != fp(**front, js_stack="    at paint (a.js:1:1)")


# ---------- HTTP against a real Postgres ----------

def _db_up() -> bool:
    try:
        socket.create_connection((settings.postgres.host, settings.postgres.port), 1).close()
        return True
    except OSError:
        return False


needs_db = pytest.mark.skipif(not _db_up(), reason="needs Postgres from POSTGRES__*")


class NoCache:
    async def get(self, session_id):
        return None

    async def remember_active(self, session_id):
        pass

    async def mark_revoked(self, session_ids):
        pass


@pytest.fixture(scope="module")
def client():
    from alembic import command
    from alembic.config import Config

    from API import router as api_router
    from APP.exception_handlers import register_exception_handlers

    command.upgrade(Config(str(WEB / "alembic.ini")), "head")
    app = FastAPI()
    app.include_router(api_router)
    register_exception_handlers(app)
    app.dependency_overrides[deps.get_session_cache] = NoCache
    with TestClient(app) as c:
        yield c


def _sql(client, query: str, **params):
    from SPI.db_adapter.db import db

    async def run():
        async with db.session_factory() as s:
            result = await s.execute(text(query), params)
            rows = result.mappings().all() if result.returns_rows else result.rowcount
            await s.commit()
            return rows

    return client.portal.call(run)


@pytest.fixture(autouse=True)
def _clean(request):
    from APP import rate_limiter

    rate_limiter.crash_ip_limiter._records.clear()
    rate_limiter.crash_install_limiter._records.clear()
    if "client" in request.fixturenames:
        c = request.getfixturevalue("client")
        _sql(c, "TRUNCATE crash_reports, crash_groups, audit_logs, sessions, users CASCADE")


def _token(client, role="user") -> dict:
    uid, sid = uuid.uuid4(), uuid.uuid4()
    now = datetime.now(tz=timezone.utc)
    _sql(
        client,
        "INSERT INTO users (id, email, username, password_hash, role, is_verified, is_beta_tester, locale,"
        " is_active) VALUES (:id, :email, :name, 'x', :role, true, false, 'ru', true)",
        id=uid, email=f"{uid.hex[:8]}@watchdemo.pro", name=f"u{uid.hex[:8]}", role=role,
    )
    _sql(
        client,
        "INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, last_used_at,"
        " is_active) VALUES (:sid, :uid, :h, :exp, :now, true)",
        sid=sid, uid=uid, h=uuid.uuid4().hex, exp=now + timedelta(days=1), now=now,
    )
    token = jwt.encode(
        {"sub": str(uid), "sid": str(sid), "type": "access", "iat": now,
         "exp": now + timedelta(minutes=5)},
        settings.jwt.secret, algorithm=settings.jwt.algorithm,
    )
    return {"Authorization": f"Bearer {token}", "_user_id": str(uid)}


def _auth(tok: dict) -> dict:
    return {"Authorization": tok["Authorization"]}


def _post(client, report: dict, headers: dict | None = None, gz=True):
    body = json.dumps(report).encode()
    h = dict(headers or {})
    if gz:
        body = gzip.compress(body)
        h["Content-Encoding"] = "gzip"
    return client.post("/api/v1/crash-reports", content=body, headers=h)


@needs_db
def test_retry_with_same_report_id_returns_same_answer(client):
    report = _report()
    first = _post(client, report)
    assert first.status_code == 202
    again = _post(client, report)
    assert again.status_code == 202 and again.json() == first.json()
    assert first.json()["report_id"] == report["report_id"]
    rows = _sql(client, "SELECT report_count FROM crash_groups")
    assert [r["report_count"] for r in rows] == [1]
    assert _sql(client, "SELECT count(*) AS n FROM crash_reports")[0]["n"] == 1


@needs_db
def test_bearer_sets_user_and_bad_token_is_anonymous(client):
    tok = _token(client)
    assert _post(client, _report(), {"Authorization": "Bearer garbage"}).status_code == 202
    assert _post(client, _report(), _auth(tok)).status_code == 202
    rows = _sql(client, "SELECT user_id::text AS u FROM crash_reports ORDER BY received_at")
    assert [r["u"] for r in rows] == [None, tok["_user_id"]]


@needs_db
def test_rejects_unknown_kind_and_bad_shapes(client):
    r = _post(client, _report(kind="segfault"))
    assert r.status_code == 422 and r.json()["code"] == "validation_failed"
    assert r.json()["detail"][0]["loc"] == ["kind"]
    assert _post(client, _report(frames=[{"module": "x", "offset": "12"}])).status_code == 422
    assert _post(client, _report(app_version="../../etc")).status_code == 422
    assert _post(client, _report(frames=[_report()["frames"][0]] * 129)).status_code == 422
    assert _post(client, _report(user_comment="x" * 2001)).status_code == 422
    # Plain JSON without gzip is accepted too.
    assert _post(client, _report(), gz=False).status_code == 202


@needs_db
def test_nul_bytes_are_stripped_before_postgres(client, monkeypatch):
    _fake_symbols(monkeypatch, ["watchdemo_lib::f"])
    raw = json.dumps(_report(message="boom\u0000", log_tail="tail\u0000\u0000"))
    r = client.post("/api/v1/crash-reports", content=raw.encode(), headers={"Content-Type": "application/json"})
    assert r.status_code == 202, r.text
    row = _sql(client, "SELECT payload->>'log_tail' AS t, title FROM crash_reports"
                       " JOIN crash_groups g ON g.id = group_id")[0]
    assert (row["t"], row["title"]) == ("tail", "boom")


@needs_db
def test_broken_symbolizer_output_leaves_raw_offsets(client, monkeypatch, tmp_path):
    (tmp_path / "0.8.1").mkdir()
    for name in ("watchdemo.exe", "watchdemo.pdb"):
        (tmp_path / "0.8.1" / name).write_bytes(b"x")
    monkeypatch.setattr(settings.symbols, "dir", str(tmp_path))
    # python rejects llvm-symbolizer's flags: empty stdout, non-zero exit.
    monkeypatch.setattr(settings.symbols, "symbolizer", sys.executable)
    assert _post(client, _report()).status_code == 202
    assert _sql(client, "SELECT symbolicated FROM crash_reports")[0]["symbolicated"] is None


@needs_db
def test_size_caps(client):
    huge = _report(log_tail="x" * (1024 * 1024))
    r = _post(client, huge, gz=False)
    assert r.status_code == 413 and r.json()["code"] == "crash_payload_too_large"

    # 50 MB of zeros gzips to ~50 KB: under the wire cap, far over the 3 MB JSON cap.
    bomb = gzip.compress(b"0" * (50 * 1024 * 1024))
    assert len(bomb) < 1024 * 1024
    r = client.post("/api/v1/crash-reports", content=bomb, headers={"Content-Encoding": "gzip"})
    assert r.status_code == 413 and r.json()["limit_bytes"] == 3 * 1024 * 1024

    body = gzip.compress(json.dumps(_report()).encode())
    r = client.post("/api/v1/crash-reports", content=body[:-20], headers={"Content-Encoding": "gzip"})
    assert r.status_code == 422 and r.json()["code"] == "crash_bad_encoding"
    r = client.post("/api/v1/crash-reports", content=b"not gzip", headers={"Content-Encoding": "gzip"})
    assert r.status_code == 422 and r.json()["code"] == "crash_bad_encoding"

    # A 2.9 MB report that compresses under 1 MB is fine.
    big = _report(log_tail="y" * (256 * 1024), js_stack="z" * (32 * 1024))
    assert _post(client, big).status_code == 202


@needs_db
def test_rate_limit_per_install_id_and_per_ip(client):
    from APP import rate_limiter

    install = str(uuid.uuid4())
    accepted = _report(install_id=install)
    first = _post(client, accepted)
    for _ in range(9):
        assert _post(client, _report(install_id=install)).status_code == 202
    rate_limiter.crash_ip_limiter._records.clear()
    r = _post(client, _report(install_id=install))
    assert r.status_code == 429 and r.json()["code"] == "rate_limited"
    # A retry of an accepted report still gets its 202 once the limit is spent.
    again = _post(client, accepted)
    assert again.status_code == 202 and again.json() == first.json()

    rate_limiter.crash_ip_limiter._records.clear()
    for _ in range(10):
        assert _post(client, _report()).status_code == 202
    r = _post(client, _report())
    assert r.status_code == 429 and r.json()["code"] == "rate_limited"


def _fake_symbols(monkeypatch, names: list[str]):
    async def fake(frames, version):
        return _symbols(*names)

    monkeypatch.setattr(crash_service, "symbolicate", fake)


@needs_db
def test_grouping_resolve_and_regression(client, monkeypatch):
    admin = _auth(_token(client, "admin"))
    _fake_symbols(monkeypatch, ["std::panicking::x", "watchdemo_lib::f::h0000000000000001"])
    g1 = _post(client, _report(app_version="0.8.0")).json()["group_id"]
    _fake_symbols(monkeypatch, ["std::panicking::x", "watchdemo_lib::f::h0000000000000002"])
    assert _post(client, _report(app_version="0.8.0")).json()["group_id"] == g1
    _fake_symbols(monkeypatch, ["watchdemo_lib::g"])
    other = _post(client, _report()).json()["group_id"]
    assert other != g1

    r = client.patch(f"/api/v1/admin/crashes/{g1}", headers=admin,
                     json={"status": "resolved", "resolved_in_version": "0.8.1", "notes": "fixed"})
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["resolved_in_version"], r.json()["notes"]) == (
        "resolved", "0.8.1", "fixed")
    audit = _sql(client, "SELECT action, details FROM audit_logs")
    assert [(a["action"], a["details"]) for a in audit] == [
        ("crash_group_status", {"group_id": g1, "from": "new", "to": "resolved"})]

    _fake_symbols(monkeypatch, ["watchdemo_lib::f"])
    _post(client, _report(app_version="0.8.1"))
    detail = client.get(f"/api/v1/admin/crashes/{g1}", headers=admin).json()
    assert (detail["status"], detail["report_count"]) == ("resolved", 3)

    _post(client, _report(app_version="0.8.2-beta.1"))
    detail = client.get(f"/api/v1/admin/crashes/{g1}", headers=admin).json()
    assert (detail["status"], detail["report_count"], detail["last_app_version"]) == (
        "new", 4, "0.8.2-beta.1")
    assert [r["app_version"] for r in detail["reports"]] == ["0.8.2-beta.1", "0.8.1", "0.8.0", "0.8.0"]
    assert "payload" not in detail["reports"][0]

    # Notes alone do not touch status or write audit; status may be omitted but not nulled.
    assert client.patch(f"/api/v1/admin/crashes/{g1}", headers=admin, json={"status": None}).status_code == 422
    client.patch(f"/api/v1/admin/crashes/{g1}", headers=admin, json={"notes": None})
    assert len(_sql(client, "SELECT 1 FROM audit_logs")) == 1
    assert client.get(f"/api/v1/admin/crashes/{g1}", headers=admin).json()["notes"] is None
    assert client.patch(f"/api/v1/admin/crashes/{g1}", headers=admin,
                        json={"resolved_in_version": "next"}).status_code == 422


@needs_db
def test_report_detail_has_payload_and_user_email(client, monkeypatch):
    admin = _auth(_token(client, "admin"))
    tok = _token(client)
    _fake_symbols(monkeypatch, ["watchdemo_lib::f"])
    report = _report(user_comment="clicked import")
    group_id = _post(client, report, _auth(tok)).json()["group_id"]
    row = client.get(f"/api/v1/admin/crashes/{group_id}", headers=admin).json()["reports"][0]
    assert row["user_email"].endswith("@watchdemo.pro")
    detail = client.get(f"/api/v1/admin/crashes/reports/{row['id']}", headers=admin).json()
    assert detail["payload"]["user_comment"] == "clicked import"
    assert detail["payload"]["breadcrumbs"][0]["message"] == "list_demos"
    assert detail["symbolicated"][0]["symbols"] == [{"function": "watchdemo_lib::f", "in_app": True}]
    missing = client.get(f"/api/v1/admin/crashes/reports/{uuid.uuid4()}", headers=admin)
    assert missing.status_code == 404 and missing.json()["code"] == "crash_report_not_found"
    missing = client.get(f"/api/v1/admin/crashes/{uuid.uuid4()}", headers=admin)
    assert missing.status_code == 404 and missing.json()["code"] == "crash_group_not_found"


@needs_db
@pytest.mark.parametrize("role", ["user", "support", "moderator"])
def test_crash_admin_is_admin_only(client, role):
    headers = _auth(_token(client, role))
    gid = uuid.uuid4()
    calls = [
        client.get("/api/v1/admin/crashes", headers=headers),
        client.get(f"/api/v1/admin/crashes/{gid}", headers=headers),
        client.get(f"/api/v1/admin/crashes/reports/{gid}", headers=headers),
        client.patch(f"/api/v1/admin/crashes/{gid}", headers=headers, json={}),
        client.post("/api/v1/admin/releases/0.8.1/symbols", headers=headers,
                    files={"pdb": ("a.pdb", b"x"), "exe": ("a.exe", b"x")}),
    ]
    assert [(r.status_code, r.json()["code"]) for r in calls] == [(403, "insufficient_role")] * 5
    assert client.get("/api/v1/admin/crashes").status_code == 401


@needs_db
def test_list_filters_and_sort(client, monkeypatch):
    admin = _auth(_token(client, "admin"))

    def post(name, **kw):
        _fake_symbols(monkeypatch, [f"watchdemo_lib::{name}"])
        return _post(client, _report(**kw)).json()["group_id"]

    a = post("a", app_version="0.8.0")
    post("a", app_version="0.8.1")
    post("a", app_version="0.8.1")
    b = post("b", app_version="0.8.1", error_code="WD-CORE-099")
    c = _post(client, _report(kind="unclean_exit", error_code="WD-CORE-002", frames=[],
                              app_version="0.7.0")).json()["group_id"]
    client.patch(f"/api/v1/admin/crashes/{b}", headers=admin, json={"status": "in_progress"})
    _sql(client, "UPDATE crash_groups SET last_seen = '2026-01-15T12:00:00Z' WHERE id = :id", id=c)

    def ids(**params):
        r = client.get("/api/v1/admin/crashes", headers=admin, params=params)
        assert r.status_code == 200, r.text
        return [g["id"] for g in r.json()["items"]]

    assert ids(sort="count")[0] == a
    assert ids() == [b, a, c]
    assert ids(status="in_progress") == [b]
    assert ids(kind="unclean_exit") == [c]
    assert ids(error_code="WD-CORE-099") == [b]
    assert ids(version="0.8.0") == [a]
    assert set(ids(version="0.8.1")) == {a, b}
    assert ids(**{"from": "2026-01-15", "to": "2026-01-15"}) == [c]
    assert ids(**{"to": "2026-01-14"}) == []
    page = client.get("/api/v1/admin/crashes", headers=admin, params={"page_size": 2, "page": 2}).json()
    assert (page["total"], [g["id"] for g in page["items"]]) == (3, [c])
    assert client.get("/api/v1/admin/crashes", headers=admin, params={"kind": "nope"}).status_code == 422


@needs_db
def test_purge_old_reports_keeps_groups(client, monkeypatch):
    from SPI.db_adapter.db import db

    _fake_symbols(monkeypatch, ["watchdemo_lib::f"])
    _post(client, _report())
    _post(client, _report())
    _sql(client, "UPDATE crash_reports SET received_at = now() - interval '91 days'"
                 " WHERE id = (SELECT id FROM crash_reports ORDER BY id LIMIT 1)")

    async def purge():
        async with db.session_factory() as s:
            n = await crash_service.purge_old_crash_reports(s, datetime.now(tz=timezone.utc))
            await s.commit()
            return n

    assert client.portal.call(purge) == 1
    assert client.portal.call(purge) == 0
    assert _sql(client, "SELECT count(*) AS n FROM crash_reports")[0]["n"] == 1
    assert _sql(client, "SELECT report_count FROM crash_groups")[0]["report_count"] == 2


@needs_db
def test_symbols_upload_replaces_files(client, monkeypatch, tmp_path):
    monkeypatch.setattr(settings.symbols, "dir", str(tmp_path))
    admin = _auth(_token(client, "admin"))
    url = "/api/v1/admin/releases/0.8.1/symbols"
    r = client.post(url, headers=admin, files={"pdb": ("x.pdb", b"pdb1"), "exe": ("x.exe", b"exe1")})
    assert r.status_code == 201 and r.json() == {"watchdemo.pdb": 4, "watchdemo.exe": 4}
    client.post(url, headers=admin, files={"pdb": ("x.pdb", b"pdb22"), "exe": ("x.exe", b"exe22")})
    assert (tmp_path / "0.8.1" / "watchdemo.pdb").read_bytes() == b"pdb22"
    assert sorted(p.name for p in (tmp_path / "0.8.1").iterdir()) == ["watchdemo.exe", "watchdemo.pdb"]
    bad = client.post("/api/v1/admin/releases/..%2F..%2Fetc/symbols", headers=admin,
                      files={"pdb": ("x.pdb", b"p"), "exe": ("x.exe", b"e")})
    assert bad.status_code in (404, 422)
    monkeypatch.setattr(settings.symbols, "max_upload_mb", 0)
    r = client.post(url, headers=admin, files={"pdb": ("x.pdb", b"p"), "exe": ("x.exe", b"e")})
    assert r.status_code == 422 and r.json()["code"] == "symbols_too_large"
    assert (tmp_path / "0.8.1" / "watchdemo.pdb").read_bytes() == b"pdb22"


BUILD = os.environ.get("CRASH_TEST_BUILD")


@needs_db
@pytest.mark.skipif(not BUILD, reason="needs CRASH_TEST_BUILD and SYMBOLS__SYMBOLIZER")
def test_real_pdb_symbolicates_at_ingest(client, monkeypatch, tmp_path):
    """Upload a real release exe+pdb, send the panic it printed, read back function and file:line."""
    build = Path(BUILD)
    monkeypatch.setattr(settings.symbols, "dir", str(tmp_path))
    admin = _auth(_token(client, "admin"))
    files = {"pdb": ("watchdemo.pdb", (build / "watchdemo.pdb").read_bytes()),
             "exe": ("watchdemo.exe", (build / "watchdemo.exe").read_bytes())}
    assert client.post("/api/v1/admin/releases/0.0.1/symbols", headers=admin, files=files).status_code == 201

    crash = json.loads((build / "crash.json").read_text(encoding="utf-8"))
    report = _report(app_version="0.0.1", frames=crash["frames"], location=crash["location"])
    group_id = _post(client, report).json()["group_id"]
    rid = client.get(f"/api/v1/admin/crashes/{group_id}", headers=admin).json()["reports"][0]["id"]
    stack = client.get(f"/api/v1/admin/crashes/reports/{rid}", headers=admin).json()["symbolicated"]
    symbols = [s for f in stack for s in f["symbols"]]
    # Defaults match the tiny symtest build; point them at the app for a real release PDB.
    fn = os.environ.get("CRASH_TEST_EXPECT_FN", "watchdemo::parse_header")
    file, line = os.environ.get("CRASH_TEST_EXPECT_AT", "main.rs:10").rsplit(":", 1)
    hit = next(s for s in symbols if s["function"] == fn)
    assert hit["file"].endswith(file) and hit["line"] == int(line)
    print("\n".join(f"{f['offset']}: {s['function']} {s['file']}:{s['line']}" for f in stack for s in f["symbols"]))

@needs_db
def test_report_built_by_the_real_app_is_accepted(client):
    """The exact upload body a release build of the desktop app produced (crash_preview IPC)."""
    report = json.loads((WEB / "tests" / "fixtures" / "app_crash_report.json").read_text(encoding="utf-8"))
    r = _post(client, report)
    assert r.status_code == 202, r.text
    assert r.json()["report_id"] == report["report_id"]
