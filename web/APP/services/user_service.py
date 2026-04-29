import uuid

from APP.constants import SubscriptionTier, UserRole
from APP.entities.session import SessionEntity
from APP.entities.subscription import SubscriptionEntity
from APP.entities.user import UserEntity
from APP.exceptions import NotFoundError
from SPI.db_adapter.models.session import SessionModel
from SPI.db_adapter.models.subscription import SubscriptionModel
from SPI.db_adapter.models.user import UserModel
from SPI.db_adapter.repositories.session_repo import SessionRepository
from SPI.db_adapter.repositories.user_repo import UserRepository


class UserService:
    def __init__(
        self,
        user_repo: UserRepository,
        session_repo: SessionRepository,
    ) -> None:
        self._user_repo = user_repo
        self._session_repo = session_repo

    async def get_profile(self, user_id: uuid.UUID) -> UserEntity:
        user = await self._user_repo.get_by_id(user_id)
        if not user:
            raise NotFoundError("User not found")
        return self._user_to_entity(user)

    async def list_sessions(self, user_id: uuid.UUID) -> list[SessionEntity]:
        sessions = await self._session_repo.get_active_by_user(user_id)
        return [self._session_to_entity(s) for s in sessions]

    async def revoke_session(
        self, user_id: uuid.UUID, session_id: uuid.UUID
    ) -> None:
        session = await self._session_repo.get_by_id(session_id)
        if not session or session.user_id != user_id:
            raise NotFoundError("Session not found")
        await self._session_repo.deactivate(session_id)

    async def revoke_all_other_sessions(
        self, user_id: uuid.UUID, current_session_id: uuid.UUID
    ) -> None:
        await self._session_repo.deactivate_all_except(user_id, current_session_id)

    @staticmethod
    def _user_to_entity(user: UserModel) -> UserEntity:
        sub_entity = None
        if user.subscription:
            sub_entity = UserService._sub_to_entity(user.subscription)
        return UserEntity(
            id=user.id,
            email=user.email,
            username=user.username,
            role=UserRole(user.role),
            is_verified=user.is_verified,
            is_active=user.is_active,
            created_at=user.created_at,
            updated_at=user.updated_at,
            subscription=sub_entity,
        )

    @staticmethod
    def _sub_to_entity(sub: SubscriptionModel) -> SubscriptionEntity:
        return SubscriptionEntity(
            id=sub.id,
            user_id=sub.user_id,
            tier=SubscriptionTier(sub.tier),
            started_at=sub.started_at,
            expires_at=sub.expires_at,
            granted_by=sub.granted_by,
            is_active=sub.is_active,
            created_at=sub.created_at,
            updated_at=sub.updated_at,
        )

    @staticmethod
    def _session_to_entity(session: SessionModel) -> SessionEntity:
        return SessionEntity(
            id=session.id,
            user_id=session.user_id,
            device_info=session.device_info,
            ip_address=session.ip_address,
            expires_at=session.expires_at,
            last_used_at=session.last_used_at,
            is_active=session.is_active,
            created_at=session.created_at,
            updated_at=session.updated_at,
        )
