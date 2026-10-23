import uuid

from APP.constants import Locale, UserRole
from APP.entities.session import SessionEntity
from APP.entities.user import UserEntity
from APP.exceptions import AlreadyExistsError, ErrorCode, NotFoundError
from APP.logger import AppLogger
from APP.services.session_revoker import SessionRevoker
from SPI.db_adapter.repositories.session_repo import SessionRepository
from SPI.db_adapter.repositories.user_repo import UserRepository

logger = AppLogger.get_logger()


class UserService:
    def __init__(
        self,
        user_repo: UserRepository,
        session_repo: SessionRepository,
        revoker: SessionRevoker,
    ) -> None:
        self._user_repo = user_repo
        self._session_repo = session_repo
        self._revoker = revoker

    async def get_profile(self, user_id: uuid.UUID) -> UserEntity:
        logger.debug("get_profile: user_id=%s", user_id)
        user = await self._user_repo.get_by_id(user_id)
        if not user:
            logger.warning("get_profile: not found user_id=%s", user_id)
            raise NotFoundError("User not found", code=ErrorCode.USER_NOT_FOUND)
        logger.info("get_profile: success user_id=%s", user_id)
        return user

    async def list_sessions(self, user_id: uuid.UUID) -> list[SessionEntity]:
        logger.debug("list_sessions: user_id=%s", user_id)
        sessions = await self._session_repo.get_active_by_user(user_id)
        logger.info("list_sessions: found %d sessions user_id=%s", len(sessions), user_id)
        return sessions

    async def revoke_session(
        self, user_id: uuid.UUID, session_id: uuid.UUID
    ) -> None:
        logger.debug("revoke_session: user_id=%s session_id=%s", user_id, session_id)
        session = await self._session_repo.get_by_id(session_id)
        if not session or session.user_id != user_id:
            logger.warning("revoke_session: not found user_id=%s session_id=%s", user_id, session_id)
            raise NotFoundError("Session not found", code=ErrorCode.SESSION_NOT_FOUND)
        await self._revoker.revoke(session_id)
        logger.info("revoke_session: success user_id=%s session_id=%s", user_id, session_id)

    async def revoke_all_other_sessions(
        self, user_id: uuid.UUID, current_session_id: uuid.UUID
    ) -> None:
        logger.debug("revoke_all_other_sessions: user_id=%s current_session_id=%s", user_id, current_session_id)
        await self._revoker.revoke_all(user_id, keep=current_session_id)
        logger.info("revoke_all_other_sessions: success user_id=%s", user_id)

    async def update_profile(
        self,
        user_id: uuid.UUID,
        username: str | None = None,
        locale: Locale | None = None,
    ) -> UserEntity:
        """Меняет имя и/или язык; `None` означает «не трогать».

        Raises:
            AlreadyExistsError: Имя занято другим пользователем.
        """
        if username is not None:
            owner = await self._user_repo.get_by_username(username)
            if owner and owner.id != user_id:
                raise AlreadyExistsError("Username already taken", code=ErrorCode.USERNAME_TAKEN)
        await self._user_repo.update_profile(user_id, username=username, locale=locale)
        logger.info("update_profile: success user_id=%s", user_id)
        return await self.get_profile(user_id)

    async def update_role(
        self,
        role: UserRole,
        user_id: uuid.UUID | None = None,
        username: str | None = None,
    ) -> UserEntity:
        logger.debug("update_role: user_id=%s username=%s role=%s", user_id, username, role)
        if user_id:
            user = await self._user_repo.get_by_id(user_id)
        elif username:
            user = await self._user_repo.get_by_username(username)
        else:
            raise ValueError("user_id or username required")

        if not user:
            logger.warning("update_role: user not found user_id=%s username=%s", user_id, username)
            raise NotFoundError("User not found", code=ErrorCode.USER_NOT_FOUND)

        await self._user_repo.update_role(user.id, role)
        logger.info("update_role: success user_id=%s role=%s", user.id, role)
        return user.model_copy(update={"role": role})
