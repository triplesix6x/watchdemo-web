import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from APP.entities.admin import AuditLogView
from APP.entities.audit_log import AuditLogEntity
from SPI.db_adapter.base_repo import SQLAlchemyRepository
from SPI.db_adapter.models.audit_log import AuditLogModel
from SPI.db_adapter.models.user import UserModel


class AuditLogRepository(SQLAlchemyRepository[AuditLogModel]):
    model = AuditLogModel

    def to_entity(self, model: AuditLogModel) -> AuditLogEntity:
        return AuditLogEntity(
            id=model.id,
            actor_id=model.actor_id,
            action=model.action,
            target_user_id=model.target_user_id,
            details=model.details or {},
            ip_address=model.ip_address,
            created_at=model.created_at,
        )

    async def list_paginated(
        self,
        offset: int,
        limit: int,
        target_user_id: uuid.UUID | None = None,
    ) -> tuple[list[AuditLogView], int]:
        """Возвращает страницу записей аудита с именами актора и цели.

        Args:
            offset: Сколько записей пропустить.
            limit: Размер страницы.
            target_user_id: Фильтр по цели действия (для карточки пользователя).

        Returns:
            Пара (записи аудита, общее количество).
        """
        actor = aliased(UserModel)
        target = aliased(UserModel)
        query = (
            select(AuditLogModel, actor.username, target.username)
            .outerjoin(actor, AuditLogModel.actor_id == actor.id)
            .outerjoin(target, AuditLogModel.target_user_id == target.id)
            .order_by(AuditLogModel.created_at.desc(), AuditLogModel.id.desc())
            .offset(offset)
            .limit(limit)
        )
        count_query = select(func.count()).select_from(AuditLogModel)
        if target_user_id is not None:
            query = query.where(AuditLogModel.target_user_id == target_user_id)
            count_query = count_query.where(AuditLogModel.target_user_id == target_user_id)

        rows = (await self.session.execute(query)).all()
        total = (await self.session.execute(count_query)).scalar_one()
        views = [self._to_view(m, actor_name, target_name) for m, actor_name, target_name in rows]
        return views, total

    @staticmethod
    def _to_view(
        model: AuditLogModel, actor_username: str | None, target_username: str | None
    ) -> AuditLogView:
        """Собирает запись аудита с подставленными именами пользователей."""
        return AuditLogView(
            id=model.id,
            actor_id=model.actor_id,
            actor_username=actor_username,
            action=model.action,
            target_user_id=model.target_user_id,
            target_username=target_username,
            details=model.details or {},
            ip_address=model.ip_address,
            created_at=model.created_at,
        )

    async def log(
        self,
        actor_id: uuid.UUID,
        action: str,
        target_user_id: uuid.UUID | None = None,
        details: dict | None = None,
        ip_address: str | None = None,
    ) -> None:
        entry = AuditLogModel(
            actor_id=actor_id,
            action=action,
            target_user_id=target_user_id,
            details=details or {},
            ip_address=ip_address,
        )
        self.session.add(entry)
        await self.session.flush()
