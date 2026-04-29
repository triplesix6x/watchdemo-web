import uuid
from datetime import datetime

from sqlalchemy import and_, select

from APP.entities.session import SessionEntity
from SPI.db_adapter.base_repo import SQLAlchemyRepository
from SPI.db_adapter.models.session import SessionModel


class SessionRepository(SQLAlchemyRepository[SessionModel]):
    model = SessionModel

    def to_entity(self, session: SessionModel) -> SessionEntity:
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

    async def get_by_id(self, session_id: uuid.UUID) -> SessionEntity | None:
        query = select(SessionModel).where(SessionModel.id == session_id)
        session = await self._execute_one_or_none(query)
        return self.to_entity(session) if session else None

    async def get_by_token_hash(
        self, token_hash: str, for_update: bool = False
    ) -> SessionEntity | None:
        query = select(SessionModel).where(SessionModel.refresh_token_hash == token_hash)
        if for_update:
            query = query.with_for_update()
        session = await self._execute_one_or_none(query)
        return self.to_entity(session) if session else None

    async def get_active_by_user(self, user_id: uuid.UUID) -> list[SessionEntity]:
        now = datetime.now().astimezone()
        query = (
            select(SessionModel)
            .where(
                and_(
                    SessionModel.user_id == user_id,
                    SessionModel.is_active == True,  # noqa: E712
                    SessionModel.expires_at > now,
                )
            )
            .order_by(SessionModel.last_used_at.desc())
        )
        sessions = await self._execute_all(query)
        return [self.to_entity(s) for s in sessions]

    async def create(
        self,
        user_id: uuid.UUID,
        refresh_token_hash: str,
        expires_at: datetime,
        last_used_at: datetime,
        device_info: str | None = None,
        ip_address: str | None = None,
    ) -> SessionEntity:
        session = SessionModel(
            user_id=user_id,
            refresh_token_hash=refresh_token_hash,
            device_info=device_info,
            ip_address=ip_address,
            expires_at=expires_at,
            last_used_at=last_used_at,
        )
        self.session.add(session)
        await self.session.flush()
        await self.session.refresh(session)
        return self.to_entity(session)

    async def update_token(
        self,
        session_id: uuid.UUID,
        new_token_hash: str,
        new_expires_at: datetime,
        last_used_at: datetime,
    ) -> None:
        query = select(SessionModel).where(SessionModel.id == session_id).with_for_update()
        session = await self._execute_one_or_none(query)
        if session:
            session.refresh_token_hash = new_token_hash
            session.expires_at = new_expires_at
            session.last_used_at = last_used_at
            await self.session.flush()

    async def deactivate(self, session_id: uuid.UUID) -> None:
        query = select(SessionModel).where(SessionModel.id == session_id).with_for_update()
        session = await self._execute_one_or_none(query)
        if session:
            session.is_active = False
            await self.session.flush()

    async def deactivate_all(self, user_id: uuid.UUID) -> None:
        query = (
            select(SessionModel)
            .where(
                and_(SessionModel.user_id == user_id, SessionModel.is_active == True)  # noqa: E712
            )
            .with_for_update()
        )
        sessions = await self._execute_all(query)
        for s in sessions:
            s.is_active = False
        await self.session.flush()

    async def deactivate_all_except(
        self, user_id: uuid.UUID, session_id: uuid.UUID
    ) -> None:
        query = (
            select(SessionModel)
            .where(
                and_(
                    SessionModel.user_id == user_id,
                    SessionModel.id != session_id,
                    SessionModel.is_active == True,  # noqa: E712
                )
            )
            .with_for_update()
        )
        sessions = await self._execute_all(query)
        for s in sessions:
            s.is_active = False
        await self.session.flush()
