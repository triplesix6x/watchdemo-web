import uuid
from datetime import datetime

from APP.entities.base import BaseEntity


class AuditLogEntity(BaseEntity):
    id: uuid.UUID
    actor_id: uuid.UUID
    action: str
    target_user_id: uuid.UUID | None = None
    details: dict = {}
    ip_address: str | None = None
    created_at: datetime
