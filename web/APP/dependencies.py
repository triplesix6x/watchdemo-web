import uuid
from typing import Annotated, NamedTuple

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from APP.config import settings
from APP.constants import UserRole
from APP.entities.user import UserEntity
from APP.exceptions import (
    InvalidTokenError,
    NotFoundError,
    PermissionDeniedError,
    TokenExpiredError,
)
from APP.services.auth_service import AuthService
from APP.services.subscription_service import SubscriptionService
from APP.services.user_service import UserService
from SPI.db_adapter.db import AnnDBSession
from SPI.db_adapter.repositories.session_repo import SessionRepository
from SPI.db_adapter.repositories.subscription_repo import SubscriptionRepository
from SPI.db_adapter.repositories.token_repo import OneTimeTokenRepository
from SPI.db_adapter.repositories.user_repo import UserRepository
from SPI.mq_adapter.publisher import MQPublisher

_bearer = HTTPBearer(auto_error=False)


class AuthContext(NamedTuple):
    user: UserEntity
    session_id: uuid.UUID


def get_publisher(request: Request) -> MQPublisher:
    return request.app.state.publisher


def get_auth_service(
    db: AnnDBSession,
    publisher: MQPublisher = Depends(get_publisher),
) -> AuthService:
    return AuthService(
        user_repo=UserRepository(db),
        session_repo=SessionRepository(db),
        subscription_repo=SubscriptionRepository(db),
        token_repo=OneTimeTokenRepository(db),
        publisher=publisher,
    )


def get_user_service(db: AnnDBSession) -> UserService:
    return UserService(
        user_repo=UserRepository(db),
        session_repo=SessionRepository(db),
    )


def get_subscription_service(db: AnnDBSession) -> SubscriptionService:
    return SubscriptionService(
        user_repo=UserRepository(db),
        subscription_repo=SubscriptionRepository(db),
    )


async def get_current_auth(
    db: AnnDBSession,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthContext:
    if not credentials:
        raise InvalidTokenError("Authorization header missing")

    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt.secret,
            algorithms=[settings.jwt.algorithm],
        )
    except jwt.ExpiredSignatureError:
        raise TokenExpiredError("Access token expired")
    except jwt.InvalidTokenError:
        raise InvalidTokenError("Invalid access token")

    if payload.get("type") != "access":
        raise InvalidTokenError("Invalid token type")

    user_id_str = payload.get("sub")
    session_id_str = payload.get("sid")
    if not user_id_str or not session_id_str:
        raise InvalidTokenError("Malformed token payload")

    try:
        user_id = uuid.UUID(user_id_str)
        session_id = uuid.UUID(session_id_str)
    except ValueError:
        raise InvalidTokenError("Malformed token payload")

    user_repo = UserRepository(db)
    user = await user_repo.get_by_id_basic(user_id)
    if not user:
        raise NotFoundError("User not found")
    if not user.is_active:
        raise PermissionDeniedError("Account is deactivated")
    return AuthContext(user=user, session_id=session_id)


def require_role(*roles: UserRole):
    async def _dep(auth: AuthContext = Depends(get_current_auth)) -> AuthContext:
        if auth.user.role not in roles:
            raise PermissionDeniedError("Insufficient permissions")
        return auth
    return _dep


CurrentAuth = Annotated[AuthContext, Depends(get_current_auth)]
AnnAuthService = Annotated[AuthService, Depends(get_auth_service)]
AnnUserService = Annotated[UserService, Depends(get_user_service)]
AnnSubscriptionService = Annotated[SubscriptionService, Depends(get_subscription_service)]
