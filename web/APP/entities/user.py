import uuid

from APP.constants import UserRole
from APP.entities.base import Entity
from APP.entities.subscription import SubscriptionEntity


class UserEntity(Entity):
    id: uuid.UUID
    email: str
    username: str
    role: UserRole
    is_verified: bool
    subscription: SubscriptionEntity | None = None
