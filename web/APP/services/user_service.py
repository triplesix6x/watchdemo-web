import uuid

from APP.entities.session import SessionEntity
from APP.entities.user import UserEntity
from APP.exceptions import NotFoundError
from APP.logger import AppLogger
from SPI.db_adapter.repositories.session_repo import SessionRepository
from SPI.db_adapter.repositories.user_repo import UserRepository

logger = AppLogger.get_logger()


class UserService:
    def __init__(
        self,
        user_repo: UserRepository,
        session_repo: SessionRepository,
    ) -> None:
        self._user_repo = user_repo
        self._session_repo = session_repo

    async def get_profile(self, user_id: uuid.UUID) -> UserEntity:
        logger.debug("get_profile: user_id=%s", user_id)
        user = await self._user_repo.get_by_id(user_id)
        if not user:
            logger.warning("get_profile: not found user_id=%s", user_id)
            raise NotFoundError("User not found")
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
            raise NotFoundError("Session not found")
        await self._session_repo.deactivate(session_id)
        logger.info("revoke_session: success user_id=%s session_id=%s", user_id, session_id)

    async def revoke_all_other_sessions(
        self, user_id: uuid.UUID, current_session_id: uuid.UUID
    ) -> None:
        logger.debug("revoke_all_other_sessions: user_id=%s current_session_id=%s", user_id, current_session_id)
        await self._session_repo.deactivate_all_except(user_id, current_session_id)
        logger.info("revoke_all_other_sessions: success user_id=%s", user_id)
