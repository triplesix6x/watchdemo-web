import uuid
from datetime import datetime

from sqlalchemy import and_, select

from APP.constants import TokenType
from APP.entities.token import OneTimeTokenEntity
from SPI.db_adapter.base_repo import SQLAlchemyRepository
from SPI.db_adapter.models.token import OneTimeTokenModel


class OneTimeTokenRepository(SQLAlchemyRepository[OneTimeTokenModel]):
    model = OneTimeTokenModel

    def to_entity(self, token: OneTimeTokenModel) -> OneTimeTokenEntity:
        return OneTimeTokenEntity(
            id=token.id,
            user_id=token.user_id,
            token_type=TokenType(token.token_type),
            expires_at=token.expires_at,
            used_at=token.used_at,
            is_active=token.is_active,
            created_at=token.created_at,
            updated_at=token.updated_at,
        )

    async def get_active(
        self, token_hash: str, token_type: TokenType
    ) -> OneTimeTokenEntity | None:
        query = select(OneTimeTokenModel).where(
            and_(
                OneTimeTokenModel.token_hash == token_hash,
                OneTimeTokenModel.token_type == token_type.value,
                OneTimeTokenModel.is_active == True,  # noqa: E712
                OneTimeTokenModel.used_at.is_(None),
            )
        )
        token = await self._execute_one_or_none(query)
        return self.to_entity(token) if token else None

    async def create(
        self,
        user_id: uuid.UUID,
        token_hash: str,
        token_type: TokenType,
        expires_at: datetime,
    ) -> OneTimeTokenEntity:
        token = OneTimeTokenModel(
            user_id=user_id,
            token_hash=token_hash,
            token_type=token_type.value,
            expires_at=expires_at,
        )
        self.session.add(token)
        await self.session.flush()
        await self.session.refresh(token)
        return self.to_entity(token)

    async def mark_used(self, token_id: uuid.UUID, used_at: datetime) -> None:
        query = (
            select(OneTimeTokenModel)
            .where(OneTimeTokenModel.id == token_id)
            .with_for_update()
        )
        token = await self._execute_one_or_none(query)
        if token:
            token.used_at = used_at
            token.is_active = False
            await self.session.flush()

    async def invalidate_all(self, user_id: uuid.UUID, token_type: TokenType) -> None:
        query = (
            select(OneTimeTokenModel)
            .where(
                and_(
                    OneTimeTokenModel.user_id == user_id,
                    OneTimeTokenModel.token_type == token_type.value,
                    OneTimeTokenModel.is_active == True,  # noqa: E712
                )
            )
            .with_for_update()
        )
        tokens = await self._execute_all(query)
        for t in tokens:
            t.is_active = False
        await self.session.flush()
