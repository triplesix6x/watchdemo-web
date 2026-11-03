"""Converged history, including databases created by the former May baseline.

Only the opt-in disposable QA database is accepted. Each DB case owns a random
schema and never resets public or another test's schema. Coordinator only, serial.
"""
import asyncio
import importlib.util
import os
from pathlib import Path
import uuid

from alembic import command
from alembic.config import Config
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
import sqlalchemy.ext.asyncio as sa_async

from APP.config import settings


WEB = Path(__file__).resolve().parents[1]
DB_URL = os.environ.get("TEST_DATABASE_URL")
HEAD = "0005_legal_prelaunch"
USER_ID = "00000000-0000-4000-8000-000000000001"


def config():
    cfg = Config(str(WEB / "alembic.ini"))
    cfg.set_main_option("script_location", str(WEB / "migrations"))
    return cfg


def test_history_is_one_chain_including_all_existing_revision_ids():
    scripts = ScriptDirectory.from_config(config())
    assert scripts.get_heads() == [HEAD]
    assert scripts.get_bases() == ["c5495913782c"]
    assert scripts.get_revision("907b2d179318").down_revision == "a1b2c3d4e5f6"
    assert {step.revision for step in scripts.walk_revisions()} >= {
        "c5495913782c", "9c6ff58f0373", "a1b2c3d4e5f6", "907b2d179318",
    }


@pytest.fixture
def schema(monkeypatch):
    if not DB_URL:
        pytest.skip("TEST_DATABASE_URL is not set")
    url = make_url(DB_URL)
    assert (url.drivername == "postgresql+asyncpg" and url.host in {"127.0.0.1", "localhost"}
            and url.port == 55438 and url.database == "watchdemo_prelaunch_qa"
            and url.username == "watchdemo_qa" and url.password == "watchdemo_qa_local_only"
            and not url.query), "Migration tests require the disposable QA database"
    assert make_url(str(settings.postgres.url)) == url
    name = "qa_migration_" + uuid.uuid4().hex
    args = {"server_settings": {"search_path": name}}

    async def sql(statement, params=None):
        engine = sa_async.create_async_engine(url, connect_args=args)
        try:
            async with engine.begin() as connection:
                result = await connection.execute(text(statement), params or {})
                return list(result.mappings()) if result.returns_rows else []
        finally:
            await engine.dispose()

    class Schema:
        cfg = config()

        def execute(self, statement, params=None):
            return asyncio.run(sql(statement, params))

        def install_former_may_baseline(self):
            path = WEB / "tests/fixtures/migrations/may_2026_baseline.py"
            spec = importlib.util.spec_from_file_location("former_may_baseline", path)
            baseline = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(baseline)

            def install(connection):
                with Operations.context(MigrationContext.configure(connection)):
                    baseline.upgrade()

            async def run():
                engine = sa_async.create_async_engine(url, connect_args=args)
                try:
                    async with engine.begin() as connection:
                        await connection.run_sync(install)
                finally:
                    await engine.dispose()
            asyncio.run(run())
            command.stamp(self.cfg, "907b2d179318")

    original = sa_async.async_engine_from_config

    def isolated_engine(*a, **kw):
        kw["connect_args"] = args
        return original(*a, **kw)

    monkeypatch.setattr(sa_async, "async_engine_from_config", isolated_engine)
    instance = Schema()
    instance.execute(f"CREATE SCHEMA {name}")
    try:
        yield instance
    finally:
        instance.execute(f"DROP SCHEMA {name} CASCADE")


def seed_accounts(schema, *, audit=False, nullable=False):
    schema.execute("""INSERT INTO users
        (id, email, username, password_hash, role, is_verified, is_active)
        VALUES (:id, 'migration@example.invalid', 'migration-qa', 'preserve-hash', 'user', true, true)""",
        {"id": USER_ID})
    for table, columns, values in [
        ("subscriptions", "tier, started_at", "'basic', now()"),
        ("sessions", "refresh_token_hash, expires_at, last_used_at", "'session-hash', now() + interval '1 day', now()"),
        ("one_time_tokens", "token_hash, token_type, expires_at", "'token-hash', 'verify_email', now() + interval '1 day'"),
    ]:
        schema.execute(f"INSERT INTO {table} (id, user_id, is_active, {columns}) "
                       f"VALUES (:id, :user_id, true, {values})",
                       {"id": str(uuid.uuid4()), "user_id": USER_ID})
    if audit:
        for details in ([None, '{"preserved": true}'] if nullable else ['{"preserved": true}']):
            schema.execute("""INSERT INTO audit_logs (id, actor_id, action, details, is_active)
                VALUES (:id, :user_id, 'migration_qa', CAST(:details AS json), true)""",
                {"id": str(uuid.uuid4()), "user_id": USER_ID, "details": details})


def assert_accounts_preserved(schema):
    assert schema.execute("SELECT id::text, email, password_hash FROM users") == [{
        "id": USER_ID, "email": "migration@example.invalid", "password_hash": "preserve-hash",
    }]
    for table in ("subscriptions", "sessions", "one_time_tokens"):
        assert schema.execute(f"SELECT user_id::text FROM {table}") == [{"user_id": USER_ID}]
    assert schema.execute("SELECT version_num FROM alembic_version") == [{"version_num": HEAD}]
    assert schema.execute("SELECT is_nullable FROM information_schema.columns WHERE "
                          "table_schema = current_schema() AND table_name = 'audit_logs' "
                          "AND column_name = 'details'") == [{"is_nullable": "NO"}]


def test_empty_database_upgrade_downgrade_base_upgrade(schema):
    command.upgrade(schema.cfg, "head")
    assert schema.execute("SELECT version_num FROM alembic_version") == [{"version_num": HEAD}]
    command.downgrade(schema.cfg, "base")
    assert schema.execute("SELECT table_name FROM information_schema.tables "
                          "WHERE table_schema = current_schema()") == [{"table_name": "alembic_version"}]
    command.upgrade(schema.cfg, "head")
    assert schema.execute("SELECT version_num FROM alembic_version") == [{"version_num": HEAD}]


@pytest.mark.parametrize("revision", ["c5495913782c", "9c6ff58f0373", "a1b2c3d4e5f6"])
def test_april_databases_upgrade_without_recreating_accounts(schema, revision):
    command.upgrade(schema.cfg, revision)
    audit = revision == "a1b2c3d4e5f6"
    seed_accounts(schema, audit=audit, nullable=True)
    command.upgrade(schema.cfg, "head")
    assert_accounts_preserved(schema)
    if audit:
        rows = schema.execute("SELECT details FROM audit_logs")
        assert len(rows) == 2
        assert {"details": {}} in rows
        assert {"details": {"preserved": True}} in rows
    # Re-running upgrade must not touch existing data.
    command.upgrade(schema.cfg, "head")
    assert_accounts_preserved(schema)


def test_original_may_database_upgrades_and_can_downgrade_to_april(schema):
    schema.install_former_may_baseline()
    seed_accounts(schema, audit=True)
    command.upgrade(schema.cfg, "head")
    assert_accounts_preserved(schema)
    assert schema.execute("SELECT details FROM audit_logs") == [{"details": {"preserved": True}}]
    command.downgrade(schema.cfg, "a1b2c3d4e5f6")
    assert schema.execute("SELECT is_nullable FROM information_schema.columns WHERE "
                          "table_schema = current_schema() AND table_name = 'audit_logs' "
                          "AND column_name = 'details'") == [{"is_nullable": "YES"}]
    command.upgrade(schema.cfg, "head")
    assert_accounts_preserved(schema)
    assert schema.execute("SELECT details FROM audit_logs") == [{"details": {"preserved": True}}]
