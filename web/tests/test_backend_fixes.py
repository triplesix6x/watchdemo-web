import ast
import asyncio
import io
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
import pytest
from fastapi import Depends, FastAPI
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
from pydantic import BaseModel
from redis.exceptions import ConnectionError as RedisConnectionError

import APP.dependencies as deps
from APP import exceptions as exc_module
from APP.config import settings
from APP.constants import Locale, SubscriptionTier, UserRole
from APP.entities.session import SessionEntity
from APP.entities.subscription import SubscriptionEntity
from APP.entities.user import UserEntity
from APP.exception_handlers import register_exception_handlers
from APP.exceptions import (
    AccountLockedError,
    ErrorCode,
    InvalidCredentialsError,
    PermissionDeniedError,
    ValidationError,
)
from APP.rate_limiter import SlidingWindowRateLimiter, make_rate_limit_dep
from APP.services.auth_service import AuthService
from APP.services.session_revoker import SessionRevoker
from APP.services.subscription_service import SubscriptionService
from SPI.redis_adapter.session_cache_repo import RedisSessionCache

WEB = Path(__file__).resolve().parents[1]
DOCS = WEB.parent / "docs" / "ERROR-CODES.md"


def _user(role=UserRole.USER, **kw) -> UserEntity:
    n = uuid.uuid4().hex[:8]
    return UserEntity(
        id=uuid.uuid4(), email=f"{n}@watchdemo.pro", username=f"u{n}", role=role,
        is_verified=True, locale=Locale.EN, **kw,
    )


# ---------- Error body ----------

def _client() -> TestClient:
    app = FastAPI()
    register_exception_handlers(app)

    class Body(BaseModel):
        n: int

    raises = {
        "creds": InvalidCredentialsError("Invalid credentials", attempts_remaining=3),
        "locked": AccountLockedError("Locked", 120),
        "weak": ValidationError("short", code=ErrorCode.PASSWORD_WEAK, rule="digit"),
        "self": PermissionDeniedError("no", code=ErrorCode.CANNOT_TARGET_SELF),
    }

    @app.get("/raise/{name}")
    async def _raise(name: str):
        raise raises[name]

    @app.post("/body")
    async def _body(body: Body):
        return {}

    limiter = SlidingWindowRateLimiter(max_requests=1, window_seconds=60)

    @app.get("/limited", dependencies=[Depends(make_rate_limit_dep(limiter))])
    async def _limited():
        return {}

    return TestClient(app)


def test_error_bodies_carry_code_and_extras():
    c = _client()
    r = c.get("/raise/creds")
    assert r.status_code == 401
    assert r.json() == {"message": "Invalid credentials", "code": "invalid_credentials", "attempts_remaining": 3}

    r = c.get("/raise/locked")
    assert r.status_code == 429 and r.headers["Retry-After"] == "120"
    assert r.json()["code"] == "too_many_attempts" and r.json()["retry_after_seconds"] == 120

    r = c.get("/raise/weak")
    assert r.status_code == 422 and r.json() == {"message": "short", "code": "password_weak", "rule": "digit"}

    r = c.get("/raise/self")
    assert r.status_code == 403 and r.json()["code"] == "cannot_target_self"


def test_schema_422_rate_limit_429_and_unknown_route_have_codes():
    c = _client()
    r = c.post("/body", json={"n": "x"})
    assert r.status_code == 422
    assert r.json()["code"] == "validation_failed" and r.json()["detail"][0]["loc"] == ["body", "n"]

    assert c.get("/limited").status_code == 200
    r = c.get("/limited")
    assert r.status_code == 429
    assert r.json()["code"] == "rate_limited" and r.json()["detail"] == r.json()["message"]

    r = c.get("/nope")
    assert r.status_code == 404 and r.json()["code"] == "http_error"


def test_error_codes_doc_matches_enum():
    documented = set(re.findall(r"^\| `([a-z_]+)` \|", DOCS.read_text(encoding="utf-8"), re.M))
    assert documented == {c.value for c in ErrorCode}


def test_every_app_exception_raise_names_a_code():
    """Codes are keyword-only and required; a missed one only fails at raise time."""
    fixed = {"InvalidCredentialsError", "AccountLockedError", "EmailNotVerifiedError"}
    needs_code = {
        name for name, obj in vars(exc_module).items()
        if isinstance(obj, type) and issubclass(obj, exc_module.AppException) and name not in fixed
    }
    missing = []
    for path in [*(WEB / "APP").rglob("*.py"), *(WEB / "API").rglob("*.py"), *(WEB / "SPI").rglob("*.py")]:
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if (
                isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id in needs_code and not any(k.arg == "code" for k in node.keywords)
            ):
                missing.append(f"{path.name}:{node.lineno}")
    assert missing == []


# ---------- Migration 0002 ----------

def test_migration_0002_hides_existing_release_notes():
    from alembic import command
    from alembic.config import Config

    buf = io.StringIO()
    cfg = Config(str(WEB / "alembic.ini"), output_buffer=buf)
    command.upgrade(cfg, "03b05dc2017c:0002_locale_changelog", sql=True)
    sql = buf.getvalue()
    add = sql.index("ADD COLUMN show_in_changelog BOOLEAN DEFAULT false NOT NULL")
    alter = sql.index("ALTER COLUMN show_in_changelog SET DEFAULT true")
    assert add < alter


# ---------- Redis outage ----------

class DownRedis:
    async def get(self, key):
        raise RedisConnectionError("down")

    async def set(self, *a, **kw):
        raise RedisConnectionError("down")

    def pipeline(self):
        class _Pipe:
            def set(self, *a, **kw):
                pass

            async def execute(self):
                raise RedisConnectionError("down")

        return _Pipe()


def _access_token(user_id, sid) -> HTTPAuthorizationCredentials:
    now = datetime.now(tz=timezone.utc)
    token = jwt.encode(
        {"sub": str(user_id), "sid": str(sid), "type": "access", "iat": now,
         "exp": now + timedelta(minutes=5)},
        settings.jwt.secret, algorithm=settings.jwt.algorithm,
    )
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


@pytest.mark.parametrize("session_active", [True, False])
def test_redis_down_falls_back_to_db(monkeypatch, session_active):
    user, sid = _user(), uuid.uuid4()
    now = datetime.now(tz=timezone.utc)
    session = SessionEntity(
        id=sid, user_id=user.id, expires_at=now + timedelta(days=1), last_used_at=now,
        is_active=session_active, device_info=None, ip_address=None,
    )

    async def get_session(self, session_id):
        return session if session_id == sid else None

    async def get_user(self, user_id):
        return user if user_id == user.id else None

    monkeypatch.setattr(deps.SessionRepository, "get_by_id", get_session)
    monkeypatch.setattr(deps.UserRepository, "get_by_id_basic", get_user)
    cache = RedisSessionCache(DownRedis())
    creds = _access_token(user.id, sid)

    if session_active:
        auth = asyncio.run(deps.get_current_auth(db=None, credentials=creds, cache=cache))
        assert auth.user.id == user.id
        assert asyncio.run(deps.get_optional_user(db=None, credentials=creds, cache=cache)) == user
    else:
        with pytest.raises(exc_module.InvalidTokenError) as e:
            asyncio.run(deps.get_current_auth(db=None, credentials=creds, cache=cache))
        assert e.value.code is ErrorCode.SESSION_REVOKED
        assert asyncio.run(deps.get_optional_user(db=None, credentials=creds, cache=cache)) is None


# ---------- delete_account ----------

class RecordingCache:
    def __init__(self):
        self.revoked = set()

    async def get(self, session_id):
        return False if session_id in self.revoked else None

    async def remember_active(self, session_id):
        pass

    async def mark_revoked(self, session_ids):
        self.revoked.update(session_ids)


class FakeSessions:
    def __init__(self, rows):
        self.rows = rows

    async def delete_all(self, user_id):
        ids = [s for s, owner in self.rows.items() if owner == user_id]
        for s in ids:
            del self.rows[s]
        return ids


class FakeSubs:
    def __init__(self, user_id):
        self.rows = {user_id: "pro"}

    async def delete(self, user_id):
        self.rows.pop(user_id, None)


class FakeAccountUsers:
    def __init__(self, user, password_hash):
        self.user, self.hash, self.anonymized = user, password_hash, None

    async def get_password_hash(self, user_id):
        return self.hash

    async def anonymize(self, user_id, email, username, password_hash):
        self.anonymized = (email, username)


class FakeTokens:
    def __init__(self):
        self.deleted = []

    async def delete_all(self, user_id):
        self.deleted.append(user_id)


def test_delete_account_removes_sessions_subscription_and_tokens():
    user, other = _user(), _user()
    s1, s2, s_other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    sessions = FakeSessions({s1: user.id, s2: user.id, s_other: other.id})
    cache, subs, tokens = RecordingCache(), FakeSubs(user.id), FakeTokens()
    users = FakeAccountUsers(user, AuthService._hash_password("Correct123"))
    service = AuthService(
        user_repo=users, session_repo=None, subscription_repo=subs, token_repo=tokens,
        publisher=None, lockout=None, revoker=SessionRevoker(sessions, cache),
    )

    with pytest.raises(ValidationError) as e:
        asyncio.run(service.delete_account(user, "Correct123", "someone-else"))
    assert e.value.code is ErrorCode.USERNAME_MISMATCH

    asyncio.run(service.delete_account(user, "Correct123", user.username.upper()))
    assert sessions.rows == {s_other: other.id}
    assert cache.revoked == {s1, s2}
    assert subs.rows == {}
    assert tokens.deleted == [user.id]
    assert users.anonymized[0].endswith("@deleted.invalid")


# ---------- Subscription target-role rule ----------

class RoleUsers:
    def __init__(self, *users):
        self.users = {u.id: u for u in users}

    async def get_by_id(self, user_id):
        return self.users.get(user_id)


class ExtendSubs:
    def __init__(self):
        self.extended = []

    async def get_by_user_id(self, user_id):
        return SubscriptionEntity(
            id=uuid.uuid4(), user_id=user_id, tier=SubscriptionTier.PRO,
            started_at=datetime.now(tz=timezone.utc),
            expires_at=datetime.now(tz=timezone.utc) + timedelta(days=3), granted_by=None,
        )

    async def set_expiry(self, user_id, expires_at, granted_by):
        self.extended.append(user_id)
        sub = await self.get_by_user_id(user_id)
        return sub.model_copy(update={"expires_at": expires_at, "granted_by": granted_by})


@pytest.mark.parametrize(
    ("target_role", "code"),
    [
        (UserRole.USER, None),
        (UserRole.MODERATOR, ErrorCode.TARGET_ROLE_TOO_HIGH),
        (UserRole.ADMIN, ErrorCode.TARGET_ROLE_TOO_HIGH),
    ],
)
def test_moderator_extend_respects_target_role(target_role, code):
    moderator, target = _user(UserRole.MODERATOR), _user(target_role)
    subs = ExtendSubs()
    service = SubscriptionService(RoleUsers(moderator, target), subs)
    if code is None:
        sub = asyncio.run(service.extend(moderator, target.id, 30))
        assert sub.granted_by == moderator.id and subs.extended == [target.id]
        return
    for call in (
        lambda: service.extend(moderator, target.id, 30),
        lambda: service.revoke(moderator, target.id),
        lambda: service.grant(moderator, SubscriptionTier.PRO, user_id=target.id),
    ):
        with pytest.raises(PermissionDeniedError) as e:
            asyncio.run(call())
        assert e.value.code is code
    assert subs.extended == []


def test_cannot_extend_own_subscription():
    moderator = _user(UserRole.MODERATOR)
    service = SubscriptionService(RoleUsers(moderator), ExtendSubs())
    with pytest.raises(PermissionDeniedError) as e:
        asyncio.run(service.extend(moderator, moderator.id, 30))
    assert e.value.code is ErrorCode.CANNOT_TARGET_SELF
