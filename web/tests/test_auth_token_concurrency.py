"""Parent-run disposable PostgreSQL characterization and D17 red regressions.

No application import opens a connection; fixtures alone create/migrate/drop an
owned random schema. Only mail delivery and the session cache are local sinks.
"""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from qa_safety import require_disposable_database

# Fail closed before application imports, independently of the global conftest.
DB_URL = os.environ.get("TEST_DATABASE_URL")
if DB_URL:
    require_disposable_database(DB_URL)

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
import sqlalchemy.ext.asyncio as sa_async

from APP.config import settings
from APP.constants import EmailMessageType, TokenType
from APP.exceptions import ErrorCode, InvalidTokenError, TokenExpiredError
from APP.services.auth_service import AuthService
from APP.services.session_revoker import SessionRevoker
from SPI.db_adapter.models.session import SessionModel
from SPI.db_adapter.models.token import OneTimeTokenModel
from SPI.db_adapter.models.user import UserModel
from SPI.db_adapter.repositories.session_repo import SessionRepository
from SPI.db_adapter.repositories.subscription_repo import SubscriptionRepository
from SPI.db_adapter.repositories.token_repo import OneTimeTokenRepository
from SPI.db_adapter.repositories.user_repo import UserRepository

KINDS = [TokenType.EMAIL_VERIFICATION, TokenType.PASSWORD_RESET, TokenType.EMAIL_CHANGE]
NEW_PASSWORD = "ReplacementPassword123"


@pytest.fixture
def auth_database(monkeypatch):
    if not DB_URL:
        pytest.skip("TEST_DATABASE_URL is not set; parent-owned PostgreSQL is required")
    require_disposable_database(DB_URL)
    assert make_url(str(settings.postgres.url)) == make_url(DB_URL)
    name = "qa_auth_token_" + uuid.uuid4().hex
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

    def migration_engine(*args, **kwargs):
        require_disposable_database(DB_URL)
        kwargs["connect_args"] = {"timeout": 5, "server_settings": server_settings}
        return original_engine(*args, **kwargs)

    monkeypatch.setattr(sa_async, "async_engine_from_config", migration_engine)
    web = Path(__file__).resolve().parents[1]
    cfg = Config(str(web / "alembic.ini"))
    cfg.set_main_option("script_location", str(web / "migrations"))
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
                    await asyncio.wait_for(scenario(async_sessionmaker(engine, expire_on_commit=False)), 30)
                finally:
                    await engine.dispose()
            asyncio.run(bounded())

        yield run
    finally:
        # The generated identifier contains only a fixed prefix and UUID hex.
        asyncio.run(schema_sql(f"DROP SCHEMA {name} CASCADE"))


class DeliverySink:
    def __init__(self, *, fail=False):
        self.messages = []
        self.fail = fail

    async def publish_email(self, message):
        if self.fail:
            raise RuntimeError("test-only delivery failure")
        self.messages.append(message)


class CacheSink:
    def __init__(self):
        self.revoked = set()

    async def mark_revoked(self, session_ids):
        self.revoked.update(session_ids)


def service(session, delivery=None, cache=None):
    sessions = SessionRepository(session)
    return AuthService(
        UserRepository(session), sessions, SubscriptionRepository(session),
        OneTimeTokenRepository(session), delivery if delivery is not None else DeliverySink(),
        None, SessionRevoker(sessions, cache if cache is not None else CacheSink()),
    )


async def seed(sm, kind, *, expired=False):
    uid, sid, raw = uuid.uuid4(), uuid.uuid4(), uuid.uuid4().hex + uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    email, target = f"{uid.hex}@example.invalid", f"new-{uid.hex}@example.invalid"
    async with sm() as session, session.begin():
        session.add(UserModel(id=uid, email=email, username=uid.hex,
            password_hash="unchanged-test-hash", role="user", is_active=True, is_verified=False))
        await session.flush()
        session.add(SessionModel(id=sid, user_id=uid,
            refresh_token_hash=AuthService._hash_token(uuid.uuid4().hex),
            expires_at=now + timedelta(days=1), last_used_at=now, is_active=True))
        token = await OneTimeTokenRepository(session).create(uid, AuthService._hash_token(raw), kind,
            now + timedelta(hours=-1 if expired else 1), payload=target if kind == TokenType.EMAIL_CHANGE else None)
        # A password-reset link must be invalidated on successful email change.
        sibling = await OneTimeTokenRepository(session).create(uid, AuthService._hash_token(uuid.uuid4().hex),
            TokenType.PASSWORD_RESET, now + timedelta(hours=1))
    return uid, sid, token.id, sibling.id, raw, email, target


async def consume(auth, kind, raw):
    if kind == TokenType.EMAIL_VERIFICATION:
        return await auth.verify_email(raw)
    if kind == TokenType.PASSWORD_RESET:
        return await auth.reset_password(raw, NEW_PASSWORD)
    return await auth.confirm_email_change(raw)


async def snapshot(sm, seeded):
    uid, sid, tid, sibling, *_ = seeded
    async with sm() as session:
        user = await session.get(UserModel, uid)
        token = await session.get(OneTimeTokenModel, tid)
        other = await session.get(OneTimeTokenModel, sibling)
        login = await session.get(SessionModel, sid)
        return (user.email, user.is_verified, user.password_hash,
                token.is_active, token.used_at, other.is_active, login.is_active)


def assert_success(state, kind, seeded):
    email, verified, password_hash, active, used, sibling_active, session_active = state
    assert active is False and used is not None
    assert email == (seeded[6] if kind == TokenType.EMAIL_CHANGE else seeded[5])
    assert verified is (kind != TokenType.PASSWORD_RESET)
    if kind == TokenType.PASSWORD_RESET:
        assert AuthService._verify_password(NEW_PASSWORD, password_hash)
    else:
        assert password_hash == "unchanged-test-hash"
    assert sibling_active is (kind != TokenType.EMAIL_CHANGE)
    assert session_active is (kind != TokenType.PASSWORD_RESET)


@pytest.mark.parametrize("kind", KINDS)
def test_one_time_token_success_and_reuse(auth_database, kind):
    async def run(sm):
        seeded = await seed(sm, kind)
        delivery, cache = DeliverySink(), CacheSink()
        async with sm() as session, session.begin():
            assert await consume(service(session, delivery, cache), kind, seeded[4]) is None
        state = await snapshot(sm, seeded)
        assert_success(state, kind, seeded)
        assert cache.revoked == ({seeded[1]} if kind == TokenType.PASSWORD_RESET else set())
        assert [m.type for m in delivery.messages] == ([EmailMessageType.WELCOME] if kind == TokenType.EMAIL_VERIFICATION else [])
        async with sm() as session, session.begin():
            with pytest.raises(InvalidTokenError) as error:
                await consume(service(session), kind, seeded[4])
            assert error.value.code == ErrorCode.TOKEN_INVALID
            assert error.value.message == "Invalid or already used token"
            assert error.value.extra == {}
        assert await snapshot(sm, seeded) == state
    auth_database(run)


@pytest.mark.parametrize("kind", KINDS)
def test_one_time_token_expired_unknown_and_wrong_type_are_unchanged(auth_database, kind):
    async def run(sm):
        seeded = await seed(sm, kind, expired=True)
        before = await snapshot(sm, seeded)
        wrong = next(value for value in KINDS if value != kind)
        for operation, raw, error_type, code, message in [
            (kind, seeded[4], TokenExpiredError, ErrorCode.TOKEN_EXPIRED, "Token expired"),
            (kind, "unknown-test-token", InvalidTokenError, ErrorCode.TOKEN_INVALID, "Invalid or already used token"),
            (wrong, seeded[4], InvalidTokenError, ErrorCode.TOKEN_INVALID, "Invalid or already used token"),
        ]:
            delivery, cache = DeliverySink(), CacheSink()
            async with sm() as session, session.begin():
                with pytest.raises(error_type) as error:
                    await consume(service(session, delivery, cache), operation, raw)
                assert (error.value.code, error.value.message, error.value.extra) == (code, message, {})
            assert await snapshot(sm, seeded) == before
            assert delivery.messages == [] and cache.revoked == set()
    auth_database(run)


class TransactionAbort(RuntimeError):
    pass


@pytest.mark.parametrize("kind", KINDS)
def test_one_time_token_rollback_restores_consumption_and_user(auth_database, kind):
    async def run(sm):
        seeded = await seed(sm, kind)
        before = await snapshot(sm, seeded)
        delivery, cache = DeliverySink(), CacheSink()
        with pytest.raises(TransactionAbort):
            async with sm() as session, session.begin():
                await consume(service(session, delivery, cache), kind, seeded[4])
                raise TransactionAbort("test-only failure before transaction commit")
        assert await snapshot(sm, seeded) == before
        # These are deliberately pre-commit external side effects, not DB rollback.
        assert cache.revoked == ({seeded[1]} if kind == TokenType.PASSWORD_RESET else set())
        assert len(delivery.messages) == (1 if kind == TokenType.EMAIL_VERIFICATION else 0)
        async with sm() as session, session.begin():
            await consume(service(session), kind, seeded[4])
        assert_success(await snapshot(sm, seeded), kind, seeded)
    auth_database(run)


def test_verification_optional_delivery_failure_does_not_rollback(auth_database):
    async def run(sm):
        seeded = await seed(sm, TokenType.EMAIL_VERIFICATION)
        async with sm() as session, session.begin():
            await service(session, DeliverySink(fail=True)).verify_email(seeded[4])
        assert_success(await snapshot(sm, seeded), TokenType.EMAIL_VERIFICATION, seeded)
    auth_database(run)


@pytest.mark.parametrize("kind", KINDS)
def test_one_time_token_two_connections_allow_only_one_consumer(auth_database, monkeypatch, kind):
    async def run(sm):
        seeded = await seed(sm, kind)
        barrier = asyncio.Barrier(2)
        pids, reads = set(), []
        original_read = OneTimeTokenRepository.get_active
        original_mark = OneTimeTokenRepository.mark_used

        async def observed_read(repository, token_hash, token_type):
            record = await original_read(repository, token_hash, token_type)
            if record is not None and record.id == seeded[2]:
                reads.append(record.id)
            return record

        async def coordinated_mark(repository, token_id, used_at):
            if token_id == seeded[2]:
                # Pause immediately before the real locking SELECT. Both callers
                # have completed all service prechecks, including email uniqueness.
                await asyncio.wait_for(barrier.wait(), timeout=5)
            return await original_mark(repository, token_id, used_at)

        monkeypatch.setattr(OneTimeTokenRepository, "get_active", observed_read)
        monkeypatch.setattr(OneTimeTokenRepository, "mark_used", coordinated_mark)

        async def contender():
            try:
                async with sm() as session, session.begin():
                    pids.add(await session.scalar(text("SELECT pg_backend_pid()")))
                    await consume(service(session), kind, seeded[4])
                return "committed"
            except InvalidTokenError as error:
                assert (error.code, error.message, error.extra) == (
                    ErrorCode.TOKEN_INVALID, "Invalid or already used token", {})
                return "rejected"

        tasks = [asyncio.create_task(contender()) for _ in range(2)]
        try:
            results = await asyncio.wait_for(asyncio.gather(*tasks), timeout=12)
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        assert len(pids) == 2, "The reproducer requires two actual PostgreSQL connections"
        assert reads == [seeded[2], seeded[2]], "Both real reads must see the same unused token"
        assert results.count("committed") == 1, f"D17 duplicate consumption: {results}"
        assert results.count("rejected") == 1
        assert_success(await snapshot(sm, seeded), kind, seeded)
    auth_database(run)
