import uuid
from collections.abc import Awaitable, Callable
from typing import Annotated, NamedTuple

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from APP.config import settings
from APP.constants import ROLE_LEVEL, UserRole
from APP.entities.user import UserEntity
from APP.exceptions import (
    ErrorCode,
    InvalidTokenError,
    NotFoundError,
    PermissionDeniedError,
    TokenExpiredError,
)
from APP.ports.lockout_port import LockoutPort
from APP.ports.session_cache_port import SessionCachePort
from APP.rate_limiter import client_ip
from APP.services.admin_service import AdminService
from APP.services.release_service import ReleaseService
from APP.services.auth_service import AuthService
from APP.services.session_revoker import SessionRevoker
from APP.services.subscription_service import SubscriptionService
from APP.services.user_service import UserService
from SPI.db_adapter.db import AnnDBSession
from SPI.db_adapter.repositories.audit_log_repo import AuditLogRepository
from SPI.db_adapter.repositories.release_repo import ReleaseRepository
from SPI.db_adapter.repositories.session_repo import SessionRepository
from SPI.db_adapter.repositories.subscription_repo import SubscriptionRepository
from SPI.db_adapter.repositories.token_repo import OneTimeTokenRepository
from SPI.db_adapter.repositories.user_repo import UserRepository
from SPI.mq_adapter.publisher import MQPublisher
from SPI.redis_adapter.lockout_repo import RedisLockoutRepo
from SPI.redis_adapter.session_cache_repo import RedisSessionCache

_bearer = HTTPBearer(auto_error=False)


class AuthContext(NamedTuple):
    user: UserEntity
    session_id: uuid.UUID


def get_publisher(request: Request) -> MQPublisher:
    return request.app.state.publisher


def get_lockout(request: Request) -> LockoutPort:
    return RedisLockoutRepo(request.app.state.redis)


def get_session_cache(request: Request) -> SessionCachePort:
    return RedisSessionCache(request.app.state.redis)


def get_revoker(
    db: AnnDBSession, cache: SessionCachePort = Depends(get_session_cache)
) -> SessionRevoker:
    return SessionRevoker(SessionRepository(db), cache)


def get_auth_service(
    db: AnnDBSession,
    publisher: MQPublisher = Depends(get_publisher),
    lockout: LockoutPort = Depends(get_lockout),
    revoker: SessionRevoker = Depends(get_revoker),
) -> AuthService:
    return AuthService(
        user_repo=UserRepository(db),
        session_repo=SessionRepository(db),
        subscription_repo=SubscriptionRepository(db),
        token_repo=OneTimeTokenRepository(db),
        publisher=publisher,
        lockout=lockout,
        revoker=revoker,
    )


def get_user_service(
    db: AnnDBSession, revoker: SessionRevoker = Depends(get_revoker)
) -> UserService:
    return UserService(
        user_repo=UserRepository(db),
        session_repo=SessionRepository(db),
        revoker=revoker,
    )


def get_subscription_service(db: AnnDBSession) -> SubscriptionService:
    return SubscriptionService(
        user_repo=UserRepository(db),
        subscription_repo=SubscriptionRepository(db),
    )


def get_audit_log_repo(db: AnnDBSession) -> AuditLogRepository:
    return AuditLogRepository(db)


def get_admin_service(
    db: AnnDBSession, revoker: SessionRevoker = Depends(get_revoker)
) -> AdminService:
    return AdminService(
        user_repo=UserRepository(db),
        subscription_repo=SubscriptionRepository(db),
        session_repo=SessionRepository(db),
        audit_repo=AuditLogRepository(db),
        token_repo=OneTimeTokenRepository(db),
        revoker=revoker,
    )


def get_release_service(db: AnnDBSession) -> ReleaseService:
    return ReleaseService(release_repo=ReleaseRepository(db))


async def _session_is_active(
    db: AnnDBSession, cache: SessionCachePort, session_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    """Жива ли сессия токена. Ответ кэшируется на 60 с, отзыв пишет «0» сразу.

    Кэш не бросает: без Redis каждый запрос просто идёт в БД.
    """
    cached = await cache.get(session_id)
    if cached is not None:
        return cached
    session = await SessionRepository(db).get_by_id(session_id)
    if not session or not session.is_active or session.user_id != user_id:
        await cache.mark_revoked([session_id])
        return False
    await cache.remember_active(session_id)
    return True


def _token_ids(payload: dict) -> tuple[uuid.UUID, uuid.UUID] | None:
    """(user_id, session_id) из access-токена или `None`, если токен не тот."""
    if payload.get("type") != "access":
        return None
    try:
        return uuid.UUID(payload["sub"]), uuid.UUID(payload["sid"])
    except (KeyError, TypeError, ValueError):
        return None


async def get_optional_user(
    db: AnnDBSession,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    cache: SessionCachePort = Depends(get_session_cache),
) -> UserEntity | None:
    """Пользователь, если запрос принёс валидный access-токен живой сессии.

    В отличие от `get_current_auth` ничего не бросает: эндпоинт
    обновления дёргается ещё до входа в аккаунт, и анонимный клиент —
    штатный случай. Токен нужен только чтобы понять, открыт ли
    пользователю бета-канал.
    """
    if not credentials:
        return None
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt.secret,
            algorithms=[settings.jwt.algorithm],
        )
    except jwt.InvalidTokenError:
        return None
    ids = _token_ids(payload)
    if not ids or not await _session_is_active(db, cache, ids[1], ids[0]):
        return None
    user = await UserRepository(db).get_by_id_basic(ids[0])
    if not user or not user.is_active:
        return None
    return user


async def get_current_auth(
    db: AnnDBSession,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    cache: SessionCachePort = Depends(get_session_cache),
) -> AuthContext:
    if not credentials:
        raise InvalidTokenError("Authorization header missing", code=ErrorCode.TOKEN_MISSING)

    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt.secret,
            algorithms=[settings.jwt.algorithm],
        )
    except jwt.ExpiredSignatureError:
        raise TokenExpiredError("Access token expired", code=ErrorCode.TOKEN_EXPIRED)
    except jwt.InvalidTokenError:
        raise InvalidTokenError("Invalid access token", code=ErrorCode.TOKEN_INVALID)

    ids = _token_ids(payload)
    if not ids:
        raise InvalidTokenError("Malformed token payload", code=ErrorCode.TOKEN_INVALID)
    user_id, session_id = ids

    if not await _session_is_active(db, cache, session_id, user_id):
        raise InvalidTokenError("Session revoked", code=ErrorCode.SESSION_REVOKED)

    user = await UserRepository(db).get_by_id_basic(user_id)
    if not user:
        raise NotFoundError("User not found", code=ErrorCode.USER_NOT_FOUND)
    if not user.is_active:
        raise PermissionDeniedError("Account is deactivated", code=ErrorCode.ACCOUNT_DEACTIVATED)
    return AuthContext(user=user, session_id=session_id)


def require_role(*roles: UserRole):
    min_level = min(ROLE_LEVEL[r] for r in roles)

    async def _dep(auth: AuthContext = Depends(get_current_auth)) -> AuthContext:
        user_level = ROLE_LEVEL.get(UserRole(auth.user.role), 0)
        if user_level < min_level:
            raise PermissionDeniedError("Insufficient permissions", code=ErrorCode.INSUFFICIENT_ROLE)
        return auth

    return _dep


CurrentAuth = Annotated[AuthContext, Depends(get_current_auth)]
AnnAuditLogRepo = Annotated[AuditLogRepository, Depends(get_audit_log_repo)]

AuditFn = Callable[..., Awaitable[None]]


def get_audit(request: Request, auth: CurrentAuth, repo: AnnAuditLogRepo) -> AuditFn:
    """Запись аудита от имени текущего пользователя и с его IP.

    `get_current_auth` FastAPI кэширует на запрос, поэтому актор тот же,
    что прошёл `require_role` в эндпоинте.
    """
    ip = client_ip(request)

    async def audit(
        action: str, target_user_id: uuid.UUID | None = None, details: dict | None = None
    ) -> None:
        await repo.log(
            actor_id=auth.user.id,
            action=action,
            target_user_id=target_user_id,
            details=details,
            ip_address=ip,
        )

    return audit


Audit = Annotated[AuditFn, Depends(get_audit)]
AnnAuthService = Annotated[AuthService, Depends(get_auth_service)]
AnnUserService = Annotated[UserService, Depends(get_user_service)]
AnnSubscriptionService = Annotated[SubscriptionService, Depends(get_subscription_service)]
AnnAdminService = Annotated[AdminService, Depends(get_admin_service)]
AnnReleaseService = Annotated[ReleaseService, Depends(get_release_service)]
OptionalUser = Annotated[UserEntity | None, Depends(get_optional_user)]
