"""Logout ownership regressions using the real route, auth, service and repositories.

Coordinator only: PostgreSQL cases reuse the opt-in disposable QA database's
random-schema fixture. No shared tables are truncated and no broker/Redis is used.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import jwt
import pytest
from fastapi import FastAPI
from sqlalchemy import select

import APP.dependencies as deps
from API.views.auth.views import router
from APP.config import settings
from APP.exception_handlers import register_exception_handlers
from APP.rate_limiter import token_rate_limit
from APP.services import auth_service
from APP.services.auth_service import AuthService
from SPI.db_adapter.db import db as app_db
from SPI.db_adapter.models.session import SessionModel
from SPI.db_adapter.models.user import UserModel
from SPI.db_adapter.repositories.session_repo import SessionRepository
from test_migration_history import schema  # noqa: F401; guarded isolated QA fixture
from test_quota_service import database


class RecordingCache:
    """Only the external cache is replaced; SessionRevoker and DB writes are real."""

    def __init__(self):
        self.revoked = set()

    async def get(self, session_id):
        return False if session_id in self.revoked else None

    async def remember_active(self, session_id):
        pass

    async def mark_revoked(self, session_ids):
        self.revoked.update(session_ids)


def access_token(user_id, session_id, *, expired=False, secret=None, algorithm=None, **claims):
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id), "sid": str(session_id), "type": "access", "iat": now,
        "exp": now + timedelta(seconds=-60 if expired else 300),
    }
    payload.update(claims)
    return jwt.encode(payload, secret or settings.jwt.secret, algorithm=algorithm or settings.jwt.algorithm)


async def seed(sm, *, user_id=None, active=True, expires=None, created=None):
    user_id = user_id or uuid.uuid4()
    session_id, rt = uuid.uuid4(), uuid.uuid4().hex + uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    async with sm() as session, session.begin():
        if await session.get(UserModel, user_id) is None:
            session.add(UserModel(
                id=user_id, email=f"{user_id}@example.invalid", username=user_id.hex,
                password_hash="test-only", role="support", is_active=True, is_verified=True,
            ))
            await session.flush()
        session.add(SessionModel(
            id=session_id, user_id=user_id, refresh_token_hash=AuthService._hash_token(rt),
            expires_at=expires or now + timedelta(days=1), last_used_at=now,
            created_at=(created or now).astimezone(timezone.utc).replace(tzinfo=None), is_active=active,
        ))
    return user_id, session_id, rt


def application(sm):
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(router, prefix="/api/v1")
    cache = RecordingCache()

    async def get_db():
        async with sm() as session, session.begin():
            yield session

    # Production dependencies still construct AuthService, SessionRevoker and all
    # repositories; only transaction lifetime and unused external IO are replaced.
    app.dependency_overrides[app_db.get_db] = get_db
    app.dependency_overrides[deps.get_session_cache] = lambda: cache
    app.dependency_overrides[deps.get_publisher] = lambda: None
    app.dependency_overrides[deps.get_lockout] = lambda: None
    app.dependency_overrides[token_rate_limit] = lambda: None

    @app.get("/probe")
    async def probe(auth: deps.CurrentAuth):
        return {"session_id": str(auth.session_id)}

    return app, cache


def set_cookie(client, rt):
    client.cookies.clear()
    if rt is not None:
        client.cookies.set("rt", rt, domain="watchdemo.example.invalid", path="/api/v1/auth")


async def logout(client, token):
    return await client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token}"} if token else {})


async def active(sm, session_id):
    async with sm() as session:
        return (await SessionRepository(session).get_by_id(session_id)).is_active


def test_crossed_cookie_logouts_do_not_lock_each_others_sessions(schema, monkeypatch):
    async def run(sm):
        a_uid, a_sid, a_rt = await seed(sm)
        b_uid, b_sid, b_rt = await seed(sm)
        app, cache = application(sm)
        barrier = asyncio.Barrier(2)
        original = SessionRepository.get_owned_refresh_session

        async def coordinated_lookup(repository, token_hash, user_id, session_id):
            result = await original(repository, token_hash, user_id, session_id)
            # Both SQL lookups have finished before either route revokes its
            # bearer. Locking the mismatched cookie owner here creates a cycle.
            await barrier.wait()
            return result

        monkeypatch.setattr(SessionRepository, "get_owned_refresh_session", coordinated_lookup)
        async with (
            httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://watchdemo.example.invalid") as a,
            httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://watchdemo.example.invalid") as b,
        ):
            set_cookie(a, b_rt)
            set_cookie(b, a_rt)
            responses = await asyncio.wait_for(asyncio.gather(
                logout(a, access_token(a_uid, a_sid)),
                logout(b, access_token(b_uid, b_sid)),
            ), timeout=8)
            assert [response.status_code for response in responses] == [204, 204]
            assert all("set-cookie" not in response.headers for response in responses)
            assert a.cookies.get("rt") == b_rt and b.cookies.get("rt") == a_rt
            assert await active(sm, a_sid) is False
            assert await active(sm, b_sid) is False
            assert cache.revoked == {a_sid, b_sid}
    database(schema, run)


def test_expired_access_matching_live_cookie_revokes_and_cannot_restore(schema):
    async def run(sm):
        uid, sid, rt = await seed(sm)
        app, cache = application(sm)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://watchdemo.example.invalid") as client:
            # Rotation keeps sid while changing rt. Logout must bind the current
            # cookie even when its captured access bearer predates that rotation.
            set_cookie(client, rt)
            rotation = await client.post("/api/v1/auth/refresh", json={})
            assert rotation.status_code == 200
            rotated_rt = rotation.json()["refresh_token"]
            response = await logout(client, access_token(uid, sid, expired=True))
            assert response.status_code == 204
            assert 'rt=""' in response.headers["set-cookie"]
            assert "Max-Age=0" in response.headers["set-cookie"]
            assert "Path=/api/v1/auth" in response.headers["set-cookie"]
            assert client.cookies.get("rt") is None
            assert await active(sm, sid) is False
            assert cache.revoked == {sid}
            assert (await client.get("/probe", headers={"Authorization": f"Bearer {access_token(uid, sid)}"})).status_code == 401
            # Restoring after reload fails; replaying even the rotated secret
            # fails too, proving actual DB revocation rather than cookie simulation.
            assert (await client.post("/api/v1/auth/refresh", json={})).status_code == 401
            assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": rotated_rt})).status_code == 401
    database(schema, run)


@pytest.mark.parametrize("same_account", [False, True])
def test_expired_access_never_revokes_or_clears_replacement_cookie(schema, same_account):
    async def run(sm):
        uid, sid, _ = await seed(sm)
        replacement_uid, replacement_sid, replacement_rt = await seed(sm, user_id=uid if same_account else None)
        app, cache = application(sm)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://watchdemo.example.invalid") as client:
            set_cookie(client, replacement_rt)
            response = await logout(client, access_token(uid, sid, expired=True))
            assert response.status_code == 401
            assert "set-cookie" not in response.headers
            assert client.cookies.get("rt") == replacement_rt
            assert await active(sm, sid) is True
            assert await active(sm, replacement_sid) is True
            assert cache.revoked == set()
            restoration = await client.post("/api/v1/auth/refresh", json={})
            assert restoration.status_code == 200
            payload = jwt.decode(restoration.json()["access_token"], settings.jwt.secret, algorithms=[settings.jwt.algorithm])
            assert (payload["sub"], payload["sid"]) == (str(replacement_uid), str(replacement_sid))
    database(schema, run)


def test_logout_invalid_credentials_have_no_revocation_or_cookie_effects(schema):
    async def run(sm):
        uid, sid, rt = await seed(sm)
        app, cache = application(sm)
        now = datetime.now(timezone.utc)
        cases = [
            ("no bearer", None, rt),
            ("expired bearer only", access_token(uid, sid, expired=True), None),
            ("unknown cookie", access_token(uid, sid, expired=True), "not-a-session-secret"),
            ("bad signature", access_token(uid, sid, expired=True, secret="wrong-test-signing-key-wrong-test-key"), rt),
            ("wrong algorithm", access_token(uid, sid, expired=True, algorithm="HS512" if settings.jwt.algorithm != "HS512" else "HS256"), rt),
            ("malformed JWT", "not-a-jwt", rt),
            ("wrong type", access_token(uid, sid, expired=True, type="refresh"), rt),
            ("wrong subject", access_token(uuid.uuid4(), sid, expired=True), rt),
            ("malformed subject", access_token("bad-sub", sid, expired=True), rt),
            ("malformed sid", access_token(uid, "bad-sid", expired=True), rt),
            ("nil sid", access_token(uid, uuid.UUID(int=0), expired=True), rt),
            ("nil subject", access_token(uuid.UUID(int=0), sid, expired=True), rt),
            ("future nbf", access_token(uid, sid, expired=True, nbf=now + timedelta(minutes=10)), rt),
            ("unexpected audience", access_token(uid, sid, expired=True, aud="other-service"), rt),
        ]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://watchdemo.example.invalid") as client:
            for name, token, cookie in cases:
                set_cookie(client, cookie)
                response = await logout(client, token)
                assert response.status_code == 401, name
                assert "set-cookie" not in response.headers, name
                assert client.cookies.get("rt") == cookie, name
                assert await active(sm, sid) is True, name
                assert cache.revoked == set(), name
    database(schema, run)


@pytest.mark.parametrize("condition", ["ttl", "max_lifetime", "revoked"])
def test_expired_access_requires_strictly_live_matching_cookie(schema, monkeypatch, condition):
    now = datetime.now(timezone.utc)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now if tz else now.replace(tzinfo=None)

    monkeypatch.setattr(auth_service, "datetime", Clock)

    async def run(sm):
        uid, sid, rt = await seed(
            sm, active=condition != "revoked",
            expires=now if condition == "ttl" else now + timedelta(days=1),
            created=now - timedelta(days=settings.app.refresh_token_max_age_days) if condition == "max_lifetime" else now,
        )
        app, cache = application(sm)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://watchdemo.example.invalid") as client:
            set_cookie(client, rt)
            response = await logout(client, access_token(uid, sid, expired=True))
            assert response.status_code == 401
            assert "set-cookie" not in response.headers
            assert client.cookies.get("rt") == rt
            assert await active(sm, sid) is (condition != "revoked")
            assert cache.revoked == set()
    database(schema, run)


def test_valid_desktop_bearer_without_cookie_still_revokes(schema):
    async def run(sm):
        uid, sid, rt = await seed(sm)
        app, cache = application(sm)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://watchdemo.example.invalid") as client:
            response = await logout(client, access_token(uid, sid))
            assert response.status_code == 204
            assert await active(sm, sid) is False
            assert cache.revoked == {sid}
            assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": rt})).status_code == 401
    database(schema, run)


@pytest.mark.parametrize("same_account", [False, True])
def test_valid_bearer_revokes_only_captured_session_and_preserves_replacement_cookie(schema, same_account):
    async def run(sm):
        uid, sid, _ = await seed(sm)
        _, replacement_sid, rt = await seed(sm, user_id=uid if same_account else None)
        app, cache = application(sm)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://watchdemo.example.invalid") as client:
            set_cookie(client, rt)
            response = await logout(client, access_token(uid, sid))
            assert response.status_code == 204
            assert "set-cookie" not in response.headers
            assert client.cookies.get("rt") == rt
            assert await active(sm, sid) is False
            assert await active(sm, replacement_sid) is True
            assert cache.revoked == {sid}
            assert (await client.post("/api/v1/auth/refresh", json={})).status_code == 200
    database(schema, run)


@pytest.mark.parametrize("condition", ["revoked", "deactivated"])
def test_unexpired_auth_refusals_do_not_use_logout_fallback(schema, condition):
    async def run(sm):
        uid, sid, rt = await seed(sm, active=condition != "revoked")
        if condition == "deactivated":
            async with sm() as session, session.begin():
                row = await session.scalar(select(UserModel).where(UserModel.id == uid))
                row.is_active = False
        app, cache = application(sm)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://watchdemo.example.invalid") as client:
            set_cookie(client, rt)
            response = await logout(client, access_token(uid, sid))
            assert response.status_code == (401 if condition == "revoked" else 403)
            assert "set-cookie" not in response.headers
            assert client.cookies.get("rt") == rt
            assert await active(sm, sid) is (condition != "revoked")
            # Normal auth may mark an already-revoked session in its cache; it
            # must not newly revoke a live session after a deactivated-user refusal.
            assert cache.revoked == ({sid} if condition == "revoked" else set())
    database(schema, run)
