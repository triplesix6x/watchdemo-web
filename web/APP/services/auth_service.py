import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import NamedTuple

import bcrypt
import jwt

from APP.config import settings
from APP.constants import EmailMessageType, Locale, TokenType
from APP.entities.token import OneTimeTokenEntity
from APP.entities.user import UserEntity
from APP.exceptions import (
    AccountLockedError,
    AlreadyExistsError,
    EmailNotVerifiedError,
    ErrorCode,
    InvalidCredentialsError,
    InvalidTokenError,
    PermissionDeniedError,
    TokenExpiredError,
    ValidationError,
)
from APP.logger import AppLogger
from APP.ports.lockout_port import LockoutPort
from APP.services.session_revoker import SessionRevoker
from SPI.db_adapter.repositories.session_repo import SessionRepository
from SPI.db_adapter.repositories.subscription_repo import SubscriptionRepository
from SPI.db_adapter.repositories.token_repo import OneTimeTokenRepository
from SPI.db_adapter.repositories.user_repo import UserRepository
from SPI.mq_adapter.publisher import MQPublisher
from SPI.mq_adapter.schemas import EmailMessage

logger = AppLogger.get_logger()

_MAX_ATTEMPTS = 5
_PASSWORD_MIN_LENGTH = 10


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
        lockout: LockoutPort,
        revoker: SessionRevoker,
    ) -> None:
        self._user_repo = user_repo
        self._session_repo = session_repo
        self._subscription_repo = subscription_repo
        self._token_repo = token_repo
        self._publisher = publisher
        self._lockout = lockout
        self._revoker = revoker

    @staticmethod
    def _generate_token() -> str:
        return secrets.token_hex(32)

    @staticmethod
    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    @staticmethod
    def _validate_password(password: str) -> None:
        """Единственный источник правил пароля; схемы проверяют только max_length."""
        if len(password) < _PASSWORD_MIN_LENGTH:
            raise ValidationError(
                f"Password must be at least {_PASSWORD_MIN_LENGTH} characters",
                code=ErrorCode.PASSWORD_WEAK, rule="min_length", min_length=_PASSWORD_MIN_LENGTH,
            )
        if not any(c.isupper() and c.isascii() for c in password):
            raise ValidationError(
                "Password must contain at least one uppercase Latin letter",
                code=ErrorCode.PASSWORD_WEAK, rule="uppercase",
            )
        if not any(c.isdigit() for c in password):
            raise ValidationError(
                "Password must contain at least one digit",
                code=ErrorCode.PASSWORD_WEAK, rule="digit",
            )

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

    @staticmethod
    def _frontend_url(path: str, locale: Locale) -> str:
        """Ссылка на сайт. Публичные страницы английской версии живут под `/en`."""
        prefix = "/en" if locale is Locale.EN else ""
        return f"{settings.app.frontend_url.rstrip('/')}{prefix}{path}"

    async def _issue_token(
        self,
        user_id: uuid.UUID,
        token_type: TokenType,
        ttl: timedelta,
        payload: str | None = None,
    ) -> str:
        """Гасит прежние токены этого типа и выпускает новый; возвращает сырой токен."""
        await self._token_repo.invalidate_all(user_id, token_type)
        token = self._generate_token()
        expires_at = datetime.now(tz=timezone.utc) + ttl
        await self._token_repo.create(
            user_id, self._hash_token(token), token_type, expires_at, payload=payload
        )
        return token

    async def _active_token(self, token: str, token_type: TokenType) -> OneTimeTokenEntity:
        """Находит непогашенный и не истёкший одноразовый токен.

        Raises:
            InvalidTokenError: Токена нет или он уже использован.
            TokenExpiredError: Срок токена вышел.
        """
        record = await self._token_repo.get_active(self._hash_token(token), token_type)
        if not record:
            logger.warning("token: invalid or used type=%s", token_type)
            raise InvalidTokenError("Invalid or already used token", code=ErrorCode.TOKEN_INVALID)
        expires = record.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(tz=timezone.utc):
            logger.warning("token: expired type=%s user_id=%s", token_type, record.user_id)
            raise TokenExpiredError("Token expired", code=ErrorCode.TOKEN_EXPIRED)
        return record

    async def _send_email(
        self,
        msg_type: EmailMessageType,
        user: UserEntity,
        data: dict,
        to_email: str | None = None,
        required: bool = True,
    ) -> None:
        """Ставит письмо в очередь на языке пользователя.

        `required=False` для уведомлений: их потеря не должна откатывать
        действие, которое уже выполнено.
        """
        try:
            await self._publisher.publish_email(
                EmailMessage(
                    type=msg_type,
                    to_email=to_email or user.email,
                    to_name=user.username,
                    data=data,
                    locale=Locale(user.locale),
                )
            )
        except Exception as e:
            logger.error("email: failed to publish type=%s user_id=%s: %s", msg_type, user.id, e)
            if required:
                raise

    async def _check_password(self, user_id: uuid.UUID, password: str) -> None:
        """Проверяет пароль уже вошедшего пользователя.

        Отвечаем 403, а не 401: на 401 клиент обновляет токен и повторяет запрос.
        """
        password_hash = await self._user_repo.get_password_hash(user_id)
        if not password_hash or not self._verify_password(password, password_hash):
            logger.warning("check_password: wrong password user_id=%s", user_id)
            raise PermissionDeniedError("Invalid password", code=ErrorCode.INVALID_PASSWORD)

    async def _send_verification(self, user: UserEntity) -> None:
        token = await self._issue_token(
            user.id,
            TokenType.EMAIL_VERIFICATION,
            timedelta(hours=settings.app.email_token_ttl_hours),
        )
        await self._send_email(
            EmailMessageType.VERIFY_EMAIL,
            user,
            {
                "verification_url": self._frontend_url(
                    f"/verify-email?token={token}", Locale(user.locale)
                ),
                "expires_in_hours": settings.app.email_token_ttl_hours,
            },
        )

    async def register(
        self, email: str, username: str, password: str, locale: Locale = Locale.RU
    ) -> UserEntity:
        logger.debug("register: attempt email=%s username=%s", email, username)
        self._validate_password(password)

        if await self._user_repo.get_by_email(email):
            logger.warning("register: email already registered email=%s", email)
            raise AlreadyExistsError("Email already registered", code=ErrorCode.EMAIL_TAKEN)
        if await self._user_repo.get_by_username(username):
            logger.warning("register: username already taken username=%s", username)
            raise AlreadyExistsError("Username already taken", code=ErrorCode.USERNAME_TAKEN)

        password_hash = self._hash_password(password)
        user = await self._user_repo.create(email, username, password_hash, locale=locale)
        await self._subscription_repo.create(user.id)
        await self._send_verification(user)

        logger.info("register: success user_id=%s email=%s", user.id, email)
        return user

    async def login(
        self,
        login: str,
        password: str,
        device_info: str | None,
        ip_address: str | None,
    ) -> LoginResult:
        login_key = login.lower().strip()
        logger.debug("login: attempt login=%s ip=%s", login_key, ip_address)

        is_locked, remaining = await self._lockout.is_locked(login_key)
        if is_locked:
            mins, secs = divmod(remaining, 60)
            logger.warning("login: account locked login=%s remaining=%ds", login_key, remaining)
            raise AccountLockedError(
                f"Account locked due to too many failed attempts. "
                f"Try again in {mins} min {secs} sec.",
                remaining,
            )

        user_model = await self._user_repo.get_by_login(login)
        password_ok = user_model is not None and self._verify_password(password, user_model.password_hash)

        if not password_ok:
            count, now_locked = await self._lockout.record_failure(login_key)
            logger.warning("login: invalid credentials login=%s attempt=%d", login_key, count)
            if now_locked:
                raise AccountLockedError(
                    f"Too many failed attempts. Account locked for {_MAX_ATTEMPTS} minutes.",
                    300,
                )
            remaining_attempts = _MAX_ATTEMPTS - count
            raise InvalidCredentialsError(
                f"Invalid credentials. "
                f"{remaining_attempts} attempt{'s' if remaining_attempts != 1 else ''} remaining before lockout.",
                attempts_remaining=remaining_attempts,
            )

        await self._lockout.reset(login_key)

        if not user_model.is_verified:
            logger.warning("login: email not verified user_id=%s", user_model.id)
            raise EmailNotVerifiedError("Email address not verified")
        if not user_model.is_active:
            logger.warning("login: account deactivated user_id=%s", user_model.id)
            raise PermissionDeniedError("Account is deactivated", code=ErrorCode.ACCOUNT_DEACTIVATED)

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
            raise InvalidTokenError("Invalid or revoked refresh token", code=ErrorCode.TOKEN_INVALID)

        now = datetime.now(tz=timezone.utc)
        session_expires = session.expires_at
        if session_expires.tzinfo is None:
            session_expires = session_expires.replace(tzinfo=timezone.utc)
        if session_expires < now:
            logger.warning("refresh_tokens: token expired session_id=%s", session.id)
            raise TokenExpiredError(
                "Refresh token expired, please log in again", code=ErrorCode.TOKEN_EXPIRED
            )

        session_created = session.created_at
        if session_created.tzinfo is None:
            session_created = session_created.replace(tzinfo=timezone.utc)
        max_expires = session_created + timedelta(days=settings.app.refresh_token_max_age_days)
        new_expires = min(now + timedelta(days=settings.app.refresh_token_ttl_days), max_expires)
        if new_expires <= now:
            logger.warning("refresh_tokens: session exceeded max lifetime session_id=%s", session.id)
            raise TokenExpiredError(
                "Session exceeded maximum lifetime, please log in again", code=ErrorCode.TOKEN_EXPIRED
            )

        new_refresh_token = self._generate_token()
        new_token_hash = self._hash_token(new_refresh_token)
        await self._session_repo.update_token(session.id, new_token_hash, new_expires, now)

        user = await self._user_repo.get_by_id_basic(session.user_id)
        if not user or not user.is_active:
            logger.warning("refresh_tokens: user not found or deactivated user_id=%s", session.user_id)
            raise PermissionDeniedError("Account is deactivated", code=ErrorCode.ACCOUNT_DEACTIVATED)

        access_token = self._create_access_token(user.id, user.role, session.id)
        logger.info("refresh_tokens: success user_id=%s session_id=%s", user.id, session.id)
        return TokenPair(access_token=access_token, refresh_token=new_refresh_token)

    async def logout(self, session_id: uuid.UUID) -> None:
        logger.debug("logout: session_id=%s", session_id)
        await self._revoker.revoke(session_id)
        logger.info("logout: success session_id=%s", session_id)

    async def verify_email(self, token: str) -> None:
        logger.debug("verify_email: attempt")
        token_record = await self._active_token(token, TokenType.EMAIL_VERIFICATION)
        await self._token_repo.mark_used(token_record.id, datetime.now(tz=timezone.utc))
        await self._user_repo.mark_verified(token_record.user_id)
        logger.info("verify_email: success user_id=%s", token_record.user_id)

        user = await self._user_repo.get_by_id_basic(token_record.user_id)
        if user:
            await self._send_email(
                EmailMessageType.WELCOME,
                user,
                {"download_url": self._frontend_url("/download", Locale(user.locale))},
                required=False,
            )

    async def forgot_password(self, email: str) -> None:
        logger.debug("forgot_password: attempt email=%s", email)
        user = await self._user_repo.get_by_email(email)
        if not user:
            logger.debug("forgot_password: email not registered email=%s", email)
            return
        await self.send_password_reset(user)

    async def send_password_reset(self, user: UserEntity) -> None:
        """Выпускает токен сброса пароля и шлёт письмо.

        Выключенным аккаунтам не шлёт: у удалённого аккаунта выдуманный адрес,
        и письмо на него только крутилось бы в очереди.
        """
        if not user.is_active:
            logger.info("send_password_reset: skip inactive user_id=%s", user.id)
            return
        token = await self._issue_token(
            user.id,
            TokenType.PASSWORD_RESET,
            timedelta(minutes=settings.app.password_reset_token_ttl_minutes),
        )
        await self._send_email(
            EmailMessageType.RESET_PASSWORD,
            user,
            {
                "reset_url": self._frontend_url(
                    f"/reset-password?token={token}", Locale(user.locale)
                ),
                "expires_in_minutes": settings.app.password_reset_token_ttl_minutes,
            },
        )
        logger.info("send_password_reset: reset email sent user_id=%s", user.id)

    async def reset_password(self, token: str, new_password: str) -> None:
        logger.debug("reset_password: attempt")
        self._validate_password(new_password)

        token_record = await self._active_token(token, TokenType.PASSWORD_RESET)
        await self._token_repo.mark_used(token_record.id, datetime.now(tz=timezone.utc))
        new_hash = self._hash_password(new_password)
        await self._user_repo.update_password(token_record.user_id, new_hash)
        await self._revoker.revoke_all(token_record.user_id)
        logger.info("reset_password: success user_id=%s", token_record.user_id)

    async def resend_verification(self, email: str) -> None:
        logger.debug("resend_verification: attempt email=%s", email)
        user = await self._user_repo.get_by_email(email)
        if not user or user.is_verified or not user.is_active:
            logger.debug("resend_verification: skip (not found, verified or inactive) email=%s", email)
            return
        await self._send_verification(user)
        logger.info("resend_verification: sent user_id=%s email=%s", user.id, email)

    # ---------- Самообслуживание: пароль, почта, удаление ----------

    async def change_password(
        self,
        user: UserEntity,
        session_id: uuid.UUID,
        current_password: str,
        new_password: str,
        sign_out_others: bool,
    ) -> None:
        """Меняет пароль по текущему и по желанию завершает другие сеансы.

        Raises:
            PermissionDeniedError: Текущий пароль неверен.
            ValidationError: Новый пароль не проходит правила.
        """
        await self._check_password(user.id, current_password)
        self._validate_password(new_password)
        await self._user_repo.update_password(user.id, self._hash_password(new_password))
        # Ссылки, выпущенные до смены пароля, могли утечь вместе со старым.
        await self._token_repo.invalidate_all(user.id, TokenType.PASSWORD_RESET)
        await self._token_repo.invalidate_all(user.id, TokenType.EMAIL_CHANGE)
        if sign_out_others:
            await self._revoker.revoke_all(user.id, keep=session_id)
        await self._send_email(
            EmailMessageType.PASSWORD_CHANGED,
            user,
            {"security_url": self._frontend_url("/account/security", Locale(user.locale))},
            required=False,
        )
        logger.info(
            "change_password: success user_id=%s sign_out_others=%s", user.id, sign_out_others
        )

    async def request_email_change(
        self, user: UserEntity, new_email: str, password: str
    ) -> None:
        """Шлёт ссылку подтверждения на новый адрес и уведомление на старый.

        Raises:
            PermissionDeniedError: Пароль неверен.
            ValidationError: Новый адрес совпадает с текущим.
            AlreadyExistsError: Адрес занят другим аккаунтом.
        """
        await self._check_password(user.id, password)
        new_email = new_email.strip().lower()
        if new_email == user.email:
            raise ValidationError(
                "New email matches the current one", code=ErrorCode.EMAIL_UNCHANGED
            )
        if await self._user_repo.get_by_email(new_email):
            raise AlreadyExistsError("Email already registered", code=ErrorCode.EMAIL_TAKEN)

        token = await self._issue_token(
            user.id,
            TokenType.EMAIL_CHANGE,
            timedelta(hours=settings.app.email_token_ttl_hours),
            payload=new_email,
        )
        await self._send_email(
            EmailMessageType.EMAIL_CHANGE_CONFIRM,
            user,
            {
                "confirm_url": self._frontend_url(
                    f"/confirm-email-change?token={token}", Locale(user.locale)
                ),
                "new_email": new_email,
                "expires_in_hours": settings.app.email_token_ttl_hours,
            },
            to_email=new_email,
        )
        await self._send_email(
            EmailMessageType.EMAIL_CHANGE_NOTICE,
            user,
            {
                "new_email": new_email,
                "security_url": self._frontend_url("/account/security", Locale(user.locale)),
            },
            required=False,
        )
        logger.info("request_email_change: sent user_id=%s", user.id)

    async def confirm_email_change(self, token: str) -> None:
        """Применяет новый адрес из токена.

        Raises:
            InvalidTokenError: Токен неизвестен, использован или аккаунт выключен.
            TokenExpiredError: Срок ссылки вышел.
            AlreadyExistsError: Адрес успели занять, пока письмо шло.
        """
        record = await self._active_token(token, TokenType.EMAIL_CHANGE)
        user = await self._user_repo.get_by_id_basic(record.user_id)
        if not user or not user.is_active or not record.payload:
            raise InvalidTokenError("Invalid or already used token", code=ErrorCode.TOKEN_INVALID)
        if await self._user_repo.get_by_email(record.payload):
            raise AlreadyExistsError("Email already registered", code=ErrorCode.EMAIL_TAKEN)
        await self._token_repo.mark_used(record.id, datetime.now(tz=timezone.utc))
        await self._user_repo.update_email(user.id, record.payload)
        # Ссылки сброса ушли на старый адрес; он больше не принадлежит аккаунту.
        await self._token_repo.invalidate_all(user.id, TokenType.PASSWORD_RESET)
        logger.info("confirm_email_change: success user_id=%s", user.id)

    async def delete_account(self, user: UserEntity, password: str, username: str) -> None:
        """Обезличивает и выключает аккаунт.

        Строка пользователя остаётся с выдуманными почтой и именем. Сеансы
        (с IP и устройствами), подписка и одноразовые токены удаляются.
        Записи аудита остаются ради безопасности: в них id пользователя и
        IP-адреса, с которых действовал он сам или админы.

        Raises:
            PermissionDeniedError: Пароль неверен.
            ValidationError: Введённое имя не совпадает с именем аккаунта.
        """
        await self._check_password(user.id, password)
        if username.strip().lower() != user.username:
            raise ValidationError("Username does not match", code=ErrorCode.USERNAME_MISMATCH)
        await self._user_repo.anonymize(
            user.id,
            email=f"deleted-{user.id.hex}@deleted.invalid",
            username=f"deleted_{user.id.hex}",
            # Случайный пароль, которого никто не знает: войти нельзя.
            password_hash=self._hash_password(secrets.token_hex(32)),
        )
        await self._revoker.delete_all(user.id)
        await self._subscription_repo.delete(user.id)
        await self._token_repo.delete_all(user.id)
        logger.info("delete_account: success user_id=%s", user.id)
