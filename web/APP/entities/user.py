import uuid

from APP.constants import Locale, UserRole
from APP.entities.base import Entity
from APP.entities.subscription import SubscriptionEntity


class UserEntity(Entity):
    id: uuid.UUID
    email: str
    username: str
    role: UserRole
    is_verified: bool
    is_beta_tester: bool = False
    locale: Locale = Locale.RU
    subscription: SubscriptionEntity | None = None
