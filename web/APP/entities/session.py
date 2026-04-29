import uuid
from datetime import datetime

from APP.entities.base import Entity


class SessionEntity(Entity):
    id: uuid.UUID
    user_id: uuid.UUID
    device_info: str | None
    ip_address: str | None
    expires_at: datetime
    last_used_at: datetime
