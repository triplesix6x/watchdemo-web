import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import NamedTuple

import bcrypt
import jwt

from APP.config import settings
from APP.constants import EmailMessageType, TokenType
from APP.entities.session import SessionEntity
from APP.entities.user import UserEntity
from APP.exceptions import (
    AlreadyExistsError,
    EmailNotVerifiedError,
    InvalidCredentialsError,
    InvalidTokenError,
    PasswordValidationError,
    PermissionDeniedError,
    TokenExpiredError,
)
from APP.logger import AppLogger
from SPI.db_adapter.repositories.session_repo import SessionRepository
from SPI.db_adapter.repositories.subscription_repo import SubscriptionRepository
from SPI.db_adapter.repositories.token_repo import OneTimeTokenRepository
from SPI.db_adapter.repositories.user_repo import UserRepository
from SPI.mq_adapter.publisher import MQPublisher
from SPI.mq_adapter.schemas import EmailMessage

logger = AppLogger.get_logger()


class LoginResult(NamedTuple):
    user: UserEntity
    access_token: str
    refresh_token: str
    session_id: uuid.UUID


class TokenPair(NamedTuple):
    access_token: str
    refresh_token: str


class AuthService:
    def __init__(
        self,
        user_repo: UserRepository,
        session_repo: SessionRepository,
        subscription_repo: SubscriptionRepository,
        token_repo: OneTimeTokenRepository,
        publisher: MQPublisher,
    ) -> None:
        self._user_repo = user_repo
        self._session_repo = session_repo
        self._subscription_repo = subscription_repo
        self._token_repo = token_repo
        self._publisher = publisher

    @staticmethod
    def _generate_token() -> str:
        return secrets.token_hex(32)

    @staticmethod
    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    @staticmethod
    def _validate_password(password: str) -> None:
        if len(password) < 10:
            raise PasswordValidationError("Password must be at least 10 characters")
        if not any(c.isupper() and c.isascii() for c in password):
            raise PasswordValidationError("Password must contain at least one uppercase Latin letter")
        if not any(c.isdigit() for c in password):
            raise PasswordValidationError("Password must contain at least one digit")

    @staticmethod
    def _hash_password(password: str) -> str:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()

    @staticmethod
    def _verify_password(password: str, password_hash: str) -> bool:
        return bcrypt.checkpw(password.encode(), password_hash.encode())

    def _create_access_token(
        self, user_id: uuid.UUID, role: str, session_id: uuid.UUID
    ) -> str:
        now = datetime.now(tz=timezone.utc)
        payload = {
            "sub": str(user_id),
            "role": role,
            "sid": str(session_id),
            "type": "access",
            "iat": now,
            "exp": now + timedelta(minutes=settings.jwt.access_token_ttl_minutes),
        }
        return jwt.encode(payload, settings.jwt.secret, algorithm=settings.jwt.algorithm)

    async def register(self, email: str, username: str, password: str) -> UserEntity:
        logger.debug("register: attempt email=%s username=%s", email, username)
        self._validate_password(password)

        if await self._user_repo.get_by_email(email):
            logger.warning("register: email already registered email=%s", email)
            raise AlreadyExistsError("Email already registered")
        if await self._user_repo.get_by_username(username):
            logger.warning("register: username already taken username=%s", username)
            raise AlreadyExistsError("Username already taken")

        password_hash = self._hash_password(password)
        user = await self._user_repo.create(email, username, password_hash)
        await self._subscription_repo.create(user.id)

        token = self._generate_token()
        token_hash = self._hash_token(token)
        expires_at = datetime.now(tz=timezone.utc) + timedelta(
            hours=settings.app.email_token_ttl_hours
        )
        await self._token_repo.create(user.id, token_hash, TokenType.EMAIL_VERIFICATION, expires_at)

        verification_url = f"{settings.app.frontend_url}/verify-email?token={token}"
        try:
            await self._publisher.publish_email(
                EmailMessage(
                    type=EmailMessageType.VERIFY_EMAIL,
                    to_email=user.email,
                    to_name=user.username,
                    data={
                        "verification_url": verification_url,
                        "expires_in_hours": settings.app.email_token_ttl_hours,
                    },
                )
            )
        except Exception as e:
            logger.error("register: failed to publish verification email user_id=%s: %s", user.id, e)
            raise

        logger.info("register: success user_id=%s email=%s", user.id, email)
        return user

    async def login(
        self,
        login: str,
        password: str,
        device_info: str | None,
        ip_address: str | None,
    ) -> LoginResult:
        logger.debug("login: attempt login=%s ip=%s", login, ip_address)
        user_model = await self._user_repo.get_by_login(login)
        if not user_model or not self._verify_password(password, user_model.password_hash):
            logger.warning("login: invalid credentials login=%s", login)
            raise InvalidCredentialsError("Invalid credentials")
        if not user_model.is_verified:
            logger.warning("login: email not verified user_id=%s", user_model.id)
            raise EmailNotVerifiedError("Email address not verified")
        if not user_model.is_active:
            logger.warning("login: account deactivated user_id=%s", user_model.id)
            raise PermissionDeniedError("Account is deactivated")

        refresh_token = self._generate_token()
        refresh_token_hash = self._hash_token(refresh_token)
        now = datetime.now(tz=timezone.utc)
        expires_at = now + timedelta(days=settings.app.refresh_token_ttl_days)

        session = await self._session_repo.create(
            user_id=user_model.id,
            refresh_token_hash=refresh_token_hash,
            device_info=device_info,
            ip_address=ip_address,
            expires_at=expires_at,
            last_used_at=now,
        )

        access_token = self._create_access_token(user_model.id, user_model.role, session.id)
        user_entity = self._user_repo.to_entity(user_model)
        logger.info("login: success user_id=%s session_id=%s", user_model.id, session.id)
        return LoginResult(
            user=user_entity,
            access_token=access_token,
            refresh_token=refresh_token,
            session_id=session.id,
        )

    async def refresh_tokens(self, refresh_token: str) -> TokenPair:
        logger.debug("refresh_tokens: attempt")
        token_hash = self._hash_token(refresh_token)
        session = await self._session_repo.get_by_token_hash(token_hash, for_update=True)

        if not session or not session.is_active:
            logger.warning("refresh_tokens: invalid or revoked token")
            raise InvalidTokenError("Invalid or revoked refresh token")

        now = datetime.now(tz=timezone.utc)
        session_expires = session.expires_at
        if session_expires.tzinfo is None:
            session_expires = session_expires.replace(tzinfo=timezone.utc)
        if session_expires < now:
            logger.warning("refresh_tokens: token expired session_id=%s", session.id)
            raise TokenExpiredError("Refresh token expired, please log in again")

        session_created = session.created_at
        if session_created.tzinfo is None:
            session_created = session_created.replace(tzinfo=timezone.utc)
        max_expires = session_created + timedelta(days=settings.app.refresh_token_max_age_days)
        new_expires = min(now + timedelta(days=settings.app.refresh_token_ttl_days), max_expires)
        if new_expires <= now:
            logger.warning("refresh_tokens: session exceeded max lifetime session_id=%s", session.id)
            raise TokenExpiredError("Session exceeded maximum lifetime, please log in again")

        new_refresh_token = self._generate_token()
        new_token_hash = self._hash_token(new_refresh_token)
        await self._session_repo.update_token(session.id, new_token_hash, new_expires, now)

        user = await self._user_repo.get_by_id_basic(session.user_id)
        if not user or not user.is_active:
            logger.warning("refresh_tokens: user not found or deactivated user_id=%s", session.user_id)
            raise PermissionDeniedError("Account is deactivated")

        access_token = self._create_access_token(user.id, user.role, session.id)
        logger.info("refresh_tokens: success user_id=%s session_id=%s", user.id, session.id)
        return TokenPair(access_token=access_token, refresh_token=new_refresh_token)

    async def logout(self, session_id: uuid.UUID) -> None:
        logger.debug("logout: session_id=%s", session_id)
        await self._session_repo.deactivate(session_id)
        logger.info("logout: success session_id=%s", session_id)

    async def verify_email(self, token: str) -> None:
        logger.debug("verify_email: attempt")
        token_hash = self._hash_token(token)
        token_record = await self._token_repo.get_active(token_hash, TokenType.EMAIL_VERIFICATION)

        if not token_record:
            logger.warning("verify_email: invalid or used token")
            raise InvalidTokenError("Invalid or already used verification token")

        now = datetime.now(tz=timezone.utc)
        token_expires = token_record.expires_at
        if token_expires.tzinfo is None:
            token_expires = token_expires.replace(tzinfo=timezone.utc)
        if token_expires < now:
            logger.warning("verify_email: token expired user_id=%s", token_record.user_id)
            raise TokenExpiredError("Verification token expired")

        await self._token_repo.mark_used(token_record.id, now)
        await self._user_repo.mark_verified(token_record.user_id)
        logger.info("verify_email: success user_id=%s", token_record.user_id)

        user = await self._user_repo.get_by_id_basic(token_record.user_id)
        if user:
            try:
                await self._publisher.publish_email(
                    EmailMessage(
                        type=EmailMessageType.WELCOME,
                        to_email=user.email,
                        to_name=user.username,
                        data={},
                    )
                )
            except Exception as e:
                logger.error("verify_email: failed to publish welcome email user_id=%s: %s", user.id, e)

    async def forgot_password(self, email: str) -> None:
        logger.debug("forgot_password: attempt email=%s", email)
        user = await self._user_repo.get_by_email(email)
        if not user:
            logger.debug("forgot_password: email not registered email=%s", email)
            return  # Silent — don't reveal whether email is registered

        await self._token_repo.invalidate_all(user.id, TokenType.PASSWORD_RESET)

        token = self._generate_token()
        token_hash = self._hash_token(token)
        expires_at = datetime.now(tz=timezone.utc) + timedelta(
            minutes=settings.app.password_reset_token_ttl_minutes
        )
        await self._token_repo.create(user.id, token_hash, TokenType.PASSWORD_RESET, expires_at)

        reset_url = f"{settings.app.frontend_url}/reset-password?token={token}"
        try:
            await self._publisher.publish_email(
                EmailMessage(
                    type=EmailMessageType.RESET_PASSWORD,
                    to_email=user.email,
                    to_name=user.username,
                    data={
                        "reset_url": reset_url,
                        "expires_in_minutes": settings.app.password_reset_token_ttl_minutes,
                    },
                )
            )
        except Exception as e:
            logger.error("forgot_password: failed to publish reset email user_id=%s: %s", user.id, e)
            raise

        logger.info("forgot_password: reset email sent user_id=%s", user.id)

    async def reset_password(self, token: str, new_password: str) -> None:
        logger.debug("reset_password: attempt")
        self._validate_password(new_password)

        token_hash = self._hash_token(token)
        token_record = await self._token_repo.get_active(token_hash, TokenType.PASSWORD_RESET)

        if not token_record:
            logger.warning("reset_password: invalid or used token")
            raise InvalidTokenError("Invalid or already used reset token")

        now = datetime.now(tz=timezone.utc)
        token_expires = token_record.expires_at
        if token_expires.tzinfo is None:
            token_expires = token_expires.replace(tzinfo=timezone.utc)
        if token_expires < now:
            logger.warning("reset_password: token expired user_id=%s", token_record.user_id)
            raise TokenExpiredError("Reset token expired")

        await self._token_repo.mark_used(token_record.id, now)
        new_hash = self._hash_password(new_password)
        await self._user_repo.update_password(token_record.user_id, new_hash)
        await self._session_repo.deactivate_all(token_record.user_id)
        logger.info("reset_password: success user_id=%s", token_record.user_id)

    async def resend_verification(self, email: str) -> None:
        logger.debug("resend_verification: attempt email=%s", email)
        user = await self._user_repo.get_by_email(email)
        if not user or user.is_verified:
            logger.debug("resend_verification: skip (not found or already verified) email=%s", email)
            return  # Silent

        await self._token_repo.invalidate_all(user.id, TokenType.EMAIL_VERIFICATION)

        token = self._generate_token()
        token_hash = self._hash_token(token)
        expires_at = datetime.now(tz=timezone.utc) + timedelta(
            hours=settings.app.email_token_ttl_hours
        )
        await self._token_repo.create(user.id, token_hash, TokenType.EMAIL_VERIFICATION, expires_at)

        verification_url = f"{settings.app.frontend_url}/verify-email?token={token}"
        try:
            await self._publisher.publish_email(
                EmailMessage(
                    type=EmailMessageType.VERIFY_EMAIL,
                    to_email=user.email,
                    to_name=user.username,
                    data={
                        "verification_url": verification_url,
                        "expires_in_hours": settings.app.email_token_ttl_hours,
                    },
                )
            )
        except Exception as e:
            logger.error("resend_verification: failed to publish email user_id=%s: %s", user.id, e)
            raise

        logger.info("resend_verification: sent user_id=%s email=%s", user.id, email)
