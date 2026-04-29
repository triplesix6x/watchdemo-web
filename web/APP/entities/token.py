import uuid
from datetime import datetime

from APP.constants import TokenType
from APP.entities.base import Entity


class OneTimeTokenEntity(Entity):
    id: uuid.UUID
    user_id: uuid.UUID
    token_type: TokenType
    expires_at: datetime
    used_at: datetime | None = None
