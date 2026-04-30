import uuid

from APP.entities.audit_log import AuditLogEntity
from SPI.db_adapter.base_repo import SQLAlchemyRepository
from SPI.db_adapter.models.audit_log import AuditLogModel


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
