"""Parent-run release contracts and D18 invariants; no production entrypoint import."""
import asyncio
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import uuid

import pytest
from qa_safety import require_disposable_database

DB_URL = os.environ.get("TEST_DATABASE_URL")
if DB_URL:
    require_disposable_database(DB_URL)

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
import sqlalchemy.ext.asyncio as sa_async

from APP.config import settings
from APP.constants import ReleaseChannel
from APP.exceptions import AlreadyExistsError, ErrorCode, ValidationError
from API.views.app.schemas import LatestRelease, UpdateManifest
from SPI.db_adapter.repositories.release_repo import ReleaseRepository


@pytest.fixture
def release_database(monkeypatch):
    if not DB_URL:
        pytest.skip("TEST_DATABASE_URL is not set; parent-owned PostgreSQL is required")
    require_disposable_database(DB_URL)
    assert make_url(str(settings.postgres.url)) == make_url(DB_URL)
    name = "qa_release_" + uuid.uuid4().hex
    server_settings = {"search_path": name, "lock_timeout": "3000", "statement_timeout": "5000"}

    async def schema_sql(statement):
        require_disposable_database(DB_URL)
        engine = create_async_engine(DB_URL, connect_args={"timeout": 5, "server_settings": {
            "lock_timeout": "3000", "statement_timeout": "5000"}})
        try:
            async with engine.begin() as connection:
                await connection.execute(text(statement))
        finally:
            await engine.dispose()

    original_engine = sa_async.async_engine_from_config
    migration_engines = []

    def migration_engine(*args, **kwargs):
        require_disposable_database(DB_URL)
        kwargs["connect_args"] = {"timeout": 5, "server_settings": server_settings}
        engine = original_engine(*args, **kwargs)
        migration_engines.append(engine)
        return engine

    monkeypatch.setattr(sa_async, "async_engine_from_config", migration_engine)
    web = Path(__file__).resolve().parents[1]
    cfg = Config(str(web / "alembic.ini"))
    cfg.set_main_option("script_location", str(web / "migrations"))
    # Fresh external storage, never a caller-selected catalog or a production path.
    with tempfile.TemporaryDirectory(prefix="watchdemo-release-qa-") as directory:
        root = Path(directory).resolve(strict=True)
        assert root.parent == Path(tempfile.gettempdir()).resolve()
        assert not root.is_relative_to(web.parent)
        catalog = root / "catalog"
        catalog.mkdir()
        marker = root / "qa-release.json"
        marker_bytes = json.dumps({"schema": name, "catalog": str(catalog)}).encode()
        marker.write_bytes(marker_bytes)
        sentinel = catalog / "unrelated-release.sentinel"
        sentinel.write_bytes(b"unrelated catalog bytes must survive")
        monkeypatch.setattr(settings.releases, "dir", str(catalog))
        monkeypatch.setattr(settings.releases, "public_base_url", "https://downloads.example.invalid/releases/")
        monkeypatch.setattr(settings.releases, "max_upload_mb", 1)
        # Redirect before importing the service and its module-level logger.
        from APP.services.release_service import ReleaseService

        asyncio.run(schema_sql(f"CREATE SCHEMA {name}"))
        try:
            require_disposable_database(DB_URL)
            command.upgrade(cfg, "head")

            def run(scenario):
                async def bounded():
                    require_disposable_database(DB_URL)
                    engine = create_async_engine(DB_URL, pool_size=2, max_overflow=0, pool_timeout=5,
                        connect_args={"timeout": 5, "server_settings": server_settings})
                    try:
                        sm = async_sessionmaker(engine, expire_on_commit=False)
                        await asyncio.wait_for(scenario(sm, catalog, ReleaseService), 30)
                    finally:
                        await engine.dispose()
                asyncio.run(bounded())

            yield run
        finally:
            try:
                async def dispose_migrations():
                    for engine in migration_engines:
                        await engine.dispose()
                asyncio.run(dispose_migrations())
                asyncio.run(schema_sql(f"DROP SCHEMA {name} CASCADE"))
            finally:
                assert marker.read_bytes() == marker_bytes
                assert sentinel.read_bytes() == b"unrelated catalog bytes must survive"


class StreamFailure(OSError):
    pass


class PrecommitAbort(RuntimeError):
    pass


class Installer:
    def __init__(self, content, filename="setup.exe", *, fail=False, blocked=None):
        self.filename = filename
        self.file = io.BytesIO(content)
        self.fail = fail
        self.blocked = blocked
        self.reads = 0

    async def read(self, size=-1):
        self.reads += 1
        if self.blocked is not None and self.reads == 2:
            self.blocked.set()
            await asyncio.Future()  # Cancelled by the owner only after the real first write.
        if self.fail and self.reads == 2:
            raise StreamFailure("test-only stream read failure after real file write")
        return self.file.read(size)


async def publish(service, installer, **changes):
    values = dict(version=" 1.2.3 ", channel=ReleaseChannel.STABLE, target="windows",
        arch="x86_64", installer=installer, signature=" sig-test \n", notes="Release notes",
        published_by=None)
    values.update(changes)
    return await service.publish(**values)


async def durable(sm):
    async with sm() as session:
        return await ReleaseRepository(session).list_paginated(0, 10)


def assert_bytes(catalog, release, content, signature="sig-test"):
    assert release.file_size == len(content)
    assert release.sha256 == hashlib.sha256(content).hexdigest()
    assert release.signature == signature
    path = catalog / release.file_path
    assert path.is_file(), "D18 committed artifact deleted by failed publisher"
    assert path.read_bytes() == content, "D18 committed artifact overwritten by losing publisher"
    assert {p.relative_to(catalog).as_posix() for p in catalog.rglob("*") if p.is_file()} == {
        "unrelated-release.sentinel", release.file_path
    }, "Publication left unexpected files in the owned catalog"


def test_release_publish_metadata_urls_and_duplicate_rejection(release_database, monkeypatch):
    async def run(sm, catalog, service_type):
        content = b"MZ\x00real test installer bytes\xff"
        async with sm() as session, session.begin():
            service = service_type(ReleaseRepository(session))
            release = await publish(service, Installer(content, "../setup ?.exe"))
        rows, total = await durable(sm)
        assert total == 1 and rows[0] == release
        assert release.version == "1.2.3" and release.channel == ReleaseChannel.STABLE
        assert release.file_name == "setup__.exe"
        assert release.file_path == "windows-x86_64/1.2.3/setup__.exe"
        assert release.notes == "Release notes" and release.published_by is None
        assert release.is_active and release.show_in_changelog
        assert release.published_at.tzinfo is not None
        assert_bytes(catalog, release, content)
        url = "https://downloads.example.invalid/releases/" + release.file_path
        assert service_type.public_url(release) == url
        manifest = UpdateManifest(version=release.version, pub_date=release.published_at,
            url=url, signature=release.signature).model_dump(mode="json")
        assert manifest == dict(version="1.2.3", pub_date=release.published_at.isoformat().replace("+00:00", "Z"),
            url=url, signature="sig-test")
        latest = LatestRelease(version=release.version, channel=release.channel, url=url,
            file_name=release.file_name, file_size=release.file_size, sha256=release.sha256,
            published_at=release.published_at, notes=release.notes).model_dump(mode="json")
        assert latest["channel"] == "stable" and latest["sha256"] == release.sha256
        assert "signature" not in latest
        monkeypatch.setattr(settings.releases, "public_base_url", "")
        assert service_type.public_url(release) == settings.app.frontend_url.rstrip("/") + "/releases/" + release.file_path
        rejected = Installer(b"must not be read", "setup__.exe")
        async with sm() as session, session.begin():
            service = service_type(ReleaseRepository(session))
            assert await service.latest_for("windows", "x86_64", False) == release
            assert await service.check_update("1.2.2", "windows", "x86_64", False) == release
            for version in ["1.2.3", "2.0.0", "bad-version"]:
                assert await service.check_update(version, "windows", "x86_64", False) is None
            with pytest.raises(AlreadyExistsError) as error:
                await publish(service, rejected)
            assert (error.value.status, error.value.code, error.value.message, error.value.extra) == (
                409, ErrorCode.RELEASE_DUPLICATE, "Release 1.2.3 for windows/x86_64 is already published", {})
        assert rejected.reads == 0
        assert await durable(sm) == (rows, total)
        assert_bytes(catalog, release, content)
    release_database(run)


@pytest.mark.parametrize("changes,content,code,message,extra,reads", [
    ({"version": "bad"}, b"bytes", ErrorCode.RELEASE_BAD_VERSION, "Invalid version: 'bad'", {}, 0),
    ({"target": "../escape"}, b"bytes", ErrorCode.RELEASE_BAD_PLATFORM, "Unknown platform: ../escape/x86_64", {}, 0),
    ({"arch": "other"}, b"bytes", ErrorCode.RELEASE_BAD_PLATFORM, "Unknown platform: windows/other", {}, 0),
    ({"signature": " \n"}, b"bytes", ErrorCode.RELEASE_BAD_SIGNATURE, "Empty release signature", {}, 0),
    ({}, b"", ErrorCode.RELEASE_EMPTY_FILE, "Empty installer file", {}, 1),
    ({}, b"x" * (1024 * 1024 + 1), ErrorCode.RELEASE_TOO_LARGE, "Installer exceeds 1 MB", {"max_upload_mb": 1}, 2),
], ids=["bad-version", "bad-target", "bad-arch", "empty-signature", "empty-installer", "oversized-installer"])
def test_release_validation_does_not_publish(release_database, changes, content, code, message, extra, reads):
    async def run(sm, catalog, service_type):
        installer = Installer(content)
        async with sm() as session, session.begin():
            with pytest.raises(ValidationError) as error:
                await publish(service_type(ReleaseRepository(session)), installer, **changes)
            assert (error.value.status, error.value.code, error.value.message, error.value.extra) == (422, code, message, extra)
        assert installer.reads == reads
        assert await durable(sm) == ([], 0)
        assert [p.relative_to(catalog).as_posix() for p in catalog.rglob("*") if p.is_file()] == ["unrelated-release.sentinel"]
    release_database(run)


def test_release_precommit_abort_rolls_back_metadata(release_database):
    async def run(sm, catalog, service_type):
        with pytest.raises(PrecommitAbort, match="before transaction commit"):
            async with sm() as session, session.begin():
                release = await publish(service_type(ReleaseRepository(session)), Installer(b"aborted bytes"))
                raise PrecommitAbort("before transaction commit")
        assert await durable(sm) == ([], 0)
        # Existing behavior: DB rollback alone does not roll back filesystem IO.
        assert (catalog / release.file_path).read_bytes() == b"aborted bytes"
    release_database(run)


@pytest.mark.parametrize("failure", ["unique_flush", "stream", "cancelled_stream"])
def test_release_interleaved_loser_preserves_committed_winner(release_database, failure):
    async def run(sm, catalog, service_type):
        loser_checked = asyncio.Event()
        winner_committed = asyncio.Event()
        reads = []
        pids = []
        transactions = []
        winner_content, loser_content = b"winner committed installer", b"loser different installer"
        blocked = asyncio.Event() if failure == "cancelled_stream" else None
        loser_installer = Installer(loser_content, fail=failure == "stream", blocked=blocked)

        async def loser():
            async with sm() as session, session.begin():
                pids.append(await session.scalar(text("SELECT pg_backend_pid()")))
                transactions.append(await session.scalar(text("SELECT txid_current()")))
                repo = ReleaseRepository(session)
                original = repo.get_by_version

                async def checked(*args):
                    result = await original(*args)
                    reads.append(result)
                    assert result is None, "D18 prerequisite: loser must really read an absent release"
                    loser_checked.set()
                    # Both real transactions remain open; no final-path IO by loser yet.
                    await asyncio.wait_for(winner_committed.wait(), 5)
                    return result

                repo.get_by_version = checked
                await publish(service_type(repo), loser_installer)

        task = asyncio.create_task(loser())
        try:
            await asyncio.wait_for(loser_checked.wait(), 5)
            async with sm() as session, session.begin():
                pids.append(await session.scalar(text("SELECT pg_backend_pid()")))
                transactions.append(await session.scalar(text("SELECT txid_current()")))
                repo = ReleaseRepository(session)
                assert await repo.get_by_version("1.2.3", "windows", "x86_64") is None
                winner = await publish(service_type(repo), Installer(winner_content))
            assert len(set(pids)) == 2 and len(set(transactions)) == 2
            assert reads == [None]
            rows, total = await durable(sm)
            assert total == 1 and rows == [winner]
            assert_bytes(catalog, winner, winner_content)
            winner_committed.set()
            if blocked is not None:
                await asyncio.wait_for(blocked.wait(), 5)
                assert loser_installer.reads == 2
                task.cancel()
            # Current duplicate collision fails during INSERT/flush, not COMMIT.
            # A future ordinary duplicate rejection is also an acceptable loser.
            try:
                await asyncio.wait_for(task, 8)
            except IntegrityError as error:
                assert failure == "unique_flush"
                assert "uq_releases_version_target_arch" in str(error.orig)
                assert "duplicate key" in str(error.orig)
            except AlreadyExistsError as error:
                assert (error.status, error.code, error.message, error.extra) == (
                    409, ErrorCode.RELEASE_DUPLICATE, "Release 1.2.3 for windows/x86_64 is already published", {})
            except StreamFailure as error:
                assert failure == "stream"
                assert str(error) == "test-only stream read failure after real file write"
                assert loser_installer.reads == 2
            except asyncio.CancelledError:
                assert failure == "cancelled_stream" and task.cancelled()
            else:
                pytest.fail("D18 prerequisite: losing publication unexpectedly committed")
            # Error type alone is not the reproduction: durable winner AND bytes are the oracle.
            assert await durable(sm) == (rows, total)
            assert_bytes(catalog, winner, winner_content)
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    release_database(run)
