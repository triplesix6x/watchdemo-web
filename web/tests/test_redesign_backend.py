import asyncio
import importlib.util
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import ValidationError

from API.views.auth.schemas import RegisterRequest
from API.views.user.schemas import UpdateProfileRequest
from APP.config import settings
from APP.constants import EmailMessageType, Locale, TokenType, UserRole
from APP.dependencies import get_current_auth
from APP.entities.token import OneTimeTokenEntity
from APP.entities.user import UserEntity
from APP.exceptions import (
    AlreadyExistsError,
    InvalidTokenError,
    PermissionDeniedError,
    ValidationError as AppValidationError,
    TokenExpiredError,
)
from APP.services.admin_service import AdminService, fill_days
from APP.services.auth_service import AuthService
from APP.tiers import tier_matrix
from SPI.redis_adapter.session_cache_repo import RedisSessionCache

WEB = Path(__file__).resolve().parents[1]


# ---------- Тарифы ----------

def test_tier_matrix_mirrors_access_rs():
    matrix = {t["id"]: {f["id"]: f for f in t["features"]} for t in tier_matrix()}
    assert list(matrix) == ["basic", "plus", "pro"]
    assert matrix["basic"]["demo_import"]["monthly_limit"] == 10
    assert matrix["plus"]["demo_import"]["monthly_limit"] == 100
    assert matrix["pro"]["demo_import"]["monthly_limit"] is None
    assert matrix["basic"]["content_search"]["allowed"]
    assert not matrix["basic"]["replay2d"]["allowed"]
    assert matrix["plus"]["replay2d"]["allowed"]
    assert not matrix["plus"]["advanced_stats"]["allowed"]
    assert all(f["allowed"] for f in matrix["pro"].values())
    assert {f["min_tier"] for f in matrix["pro"].values()} == {"basic", "plus", "pro"}


# ---------- Валидация на границе ----------

def test_username_rules_shared_by_register_and_profile():
    assert UpdateProfileRequest(username="  New_Name-1 ").username == "new_name-1"
    assert UpdateProfileRequest().username is None
    for bad in ("ab", "x" * 51, "with space", "dot.name"):
        with pytest.raises(ValidationError):
            UpdateProfileRequest(username=bad)
        with pytest.raises(ValidationError):
            RegisterRequest(email="a@b.io", username=bad, password="Password123")


def test_locale_accepts_only_ru_and_en():
    assert RegisterRequest(email="a@b.io", username="abc", password="Password123").locale is Locale.RU
    assert UpdateProfileRequest(locale="en").locale is Locale.EN
    with pytest.raises(ValidationError):
        UpdateProfileRequest(locale="de")
    with pytest.raises(ValidationError):
        RegisterRequest(email="a@b.io", username="abc", password="Password123", locale="fr")


# ---------- Графики админки ----------

def test_fill_days_zero_fills_and_ends_today():
    today = date(2026, 10, 23)
    series = fill_days({date(2026, 10, 21): 3, date(2026, 9, 1): 99}, 3, today)
    assert series == [(date(2026, 10, 21), 3), (date(2026, 10, 22), 0), (date(2026, 10, 23), 0)]
    assert len(fill_days({}, 90, today)) == 90


# ---------- Смена почты ----------

class FakeUsers:
    def __init__(self, *users: UserEntity, password_hash: str):
        self.users = {u.id: u for u in users}
        self.hash = password_hash

    async def get_password_hash(self, user_id):
        return self.hash if user_id in self.users else None

    async def get_by_email(self, email):
        return next((u for u in self.users.values() if u.email == email.lower()), None)

    async def get_by_id_basic(self, user_id):
        return self.users.get(user_id)

    async def update_email(self, user_id, email):
        self.users[user_id] = self.users[user_id].model_copy(update={"email": email})


class FakeTokens:
    def __init__(self):
        self.rows: dict[str, OneTimeTokenEntity] = {}

    async def invalidate_all(self, user_id, token_type):
        for h, t in list(self.rows.items()):
            if t.user_id == user_id and t.token_type == token_type:
                self.rows[h] = t.model_copy(update={"is_active": False})

    async def create(self, user_id, token_hash, token_type, expires_at, payload=None):
        self.rows[token_hash] = OneTimeTokenEntity(
            id=uuid.uuid4(), user_id=user_id, token_type=token_type,
            expires_at=expires_at, payload=payload,
        )

    async def get_active(self, token_hash, token_type):
        t = self.rows.get(token_hash)
        if t and t.token_type == token_type and t.is_active and t.used_at is None:
            return t
        return None

    async def mark_used(self, token_id, used_at):
        for h, t in self.rows.items():
            if t.id == token_id:
                self.rows[h] = t.model_copy(update={"used_at": used_at, "is_active": False})


class FakePublisher:
    def __init__(self):
        self.sent = []

    async def publish_email(self, message):
        self.sent.append(message)


def _user(email="old@watchdemo.pro", username="player", locale=Locale.EN) -> UserEntity:
    return UserEntity(
        id=uuid.uuid4(), email=email, username=username, role=UserRole.USER,
        is_verified=True, locale=locale,
    )


def _service(*users):
    users_repo = FakeUsers(*users, password_hash=AuthService._hash_password("Correct123"))
    tokens, publisher = FakeTokens(), FakePublisher()
    service = AuthService(
        user_repo=users_repo, session_repo=None, subscription_repo=None,
        token_repo=tokens, publisher=publisher, lockout=None, revoker=None,
    )
    return service, users_repo, tokens, publisher


def _token_from(publisher) -> str:
    confirm = next(m for m in publisher.sent if m.type == EmailMessageType.EMAIL_CHANGE_CONFIRM)
    return parse_qs(urlparse(confirm.data["confirm_url"]).query)["token"][0]


def test_email_change_round_trip():
    user = _user()
    service, users, tokens, publisher = _service(user)

    asyncio.run(service.request_email_change(user, " New@WatchDemo.pro ", "Correct123"))

    by_type = {m.type: m for m in publisher.sent}
    assert by_type[EmailMessageType.EMAIL_CHANGE_CONFIRM].to_email == "new@watchdemo.pro"
    assert by_type[EmailMessageType.EMAIL_CHANGE_NOTICE].to_email == "old@watchdemo.pro"
    assert all(m.locale is Locale.EN for m in publisher.sent)
    token = _token_from(publisher)
    stored = next(iter(tokens.rows.values()))
    assert stored.token_type == TokenType.EMAIL_CHANGE and stored.payload == "new@watchdemo.pro"
    assert timedelta(hours=23) < stored.expires_at - datetime.now(tz=timezone.utc) <= timedelta(hours=24)

    asyncio.run(service.confirm_email_change(token))
    assert users.users[user.id].email == "new@watchdemo.pro"
    with pytest.raises(InvalidTokenError):
        asyncio.run(service.confirm_email_change(token))


def test_email_change_rejections():
    user, other = _user(), _user(email="taken@watchdemo.pro", username="other")
    service, users, tokens, publisher = _service(user, other)

    with pytest.raises(PermissionDeniedError):
        asyncio.run(service.request_email_change(user, "new@watchdemo.pro", "Wrong12345"))
    with pytest.raises(AppValidationError):
        asyncio.run(service.request_email_change(user, "OLD@watchdemo.pro", "Correct123"))
    with pytest.raises(AlreadyExistsError):
        asyncio.run(service.request_email_change(user, "taken@watchdemo.pro", "Correct123"))
    assert publisher.sent == []

    asyncio.run(service.request_email_change(user, "new@watchdemo.pro", "Correct123"))
    token = _token_from(publisher)
    for h, t in tokens.rows.items():
        tokens.rows[h] = t.model_copy(update={"expires_at": datetime.now(tz=timezone.utc) - timedelta(seconds=1)})
    with pytest.raises(TokenExpiredError):
        asyncio.run(service.confirm_email_change(token))
    assert users.users[user.id].email == "old@watchdemo.pro"


# ---------- Отзыв сессии ----------

class FakeRedis:
    """Ровно то, что зовёт RedisSessionCache: get, set(nx, ex), pipeline."""

    def __init__(self):
        self.data = {}

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value, ex=None, nx=False):
        if nx and key in self.data:
            return None
        self.data[key] = value
        return True

    def pipeline(self):
        redis, ops = self, []

        class _Pipe:
            def set(self, *args, **kwargs):
                ops.append((args, kwargs))

            async def execute(self):
                return [await redis.set(*a, **kw) for a, kw in ops]

        return _Pipe()


def test_revoke_wins_over_stale_active_write():
    cache = RedisSessionCache(FakeRedis())
    sid = uuid.uuid4()
    asyncio.run(cache.mark_revoked([sid]))
    # Запрос, прочитавший БД до коммита отзыва, не должен оживить сессию.
    asyncio.run(cache.remember_active(sid))
    assert asyncio.run(cache.get(sid)) is False


def test_access_token_of_revoked_session_is_rejected():
    cache = RedisSessionCache(FakeRedis())
    user_id, sid = uuid.uuid4(), uuid.uuid4()
    now = datetime.now(tz=timezone.utc)
    token = jwt.encode(
        {"sub": str(user_id), "sid": str(sid), "type": "access", "iat": now,
         "exp": now + timedelta(minutes=5)},
        settings.jwt.secret, algorithm=settings.jwt.algorithm,
    )
    asyncio.run(cache.mark_revoked([sid]))
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    with pytest.raises(InvalidTokenError, match="revoked"):
        asyncio.run(get_current_auth(db=None, credentials=creds, cache=cache))


# ---------- Права админки ----------

class RoleUsers:
    def __init__(self, *users):
        self.users = {u.id: u for u in users}

    async def get_by_id(self, user_id):
        return self.users.get(user_id)


@pytest.mark.parametrize(
    ("actor_role", "target_role", "allowed"),
    [
        (UserRole.MODERATOR, UserRole.USER, True),
        (UserRole.MODERATOR, UserRole.MODERATOR, False),
        (UserRole.MODERATOR, UserRole.ADMIN, False),
        (UserRole.ADMIN, UserRole.ADMIN, True),
    ],
)
def test_modifiable_target_role_rules(actor_role, target_role, allowed):
    actor = _user(username="actor").model_copy(update={"role": actor_role})
    target = _user(username="target").model_copy(update={"role": target_role})
    service = AdminService(RoleUsers(actor, target), None, None, None, None, None)
    if allowed:
        assert asyncio.run(service.get_target(actor, target.id, "strict")).id == target.id
    else:
        with pytest.raises(PermissionDeniedError):
            asyncio.run(service.get_target(actor, target.id, "strict"))
    with pytest.raises(PermissionDeniedError):
        asyncio.run(service.get_target(actor, actor.id, "strict"))


# ---------- Миграции ----------

def test_migration_chain_has_single_head():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    path = WEB / "migrations" / "versions" / "20261023_0002_locale_changelog_email_change.py"
    spec = importlib.util.spec_from_file_location("m0002", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == "03b05dc2017c"
    assert callable(module.upgrade) and callable(module.downgrade)

    script = ScriptDirectory.from_config(Config(str(WEB / "alembic.ini")))
    assert script.get_heads() == [module.revision]
