import uuid
from abc import ABC, abstractmethod
from collections.abc import Iterable


class SessionCachePort(ABC):
    """Кэш статуса сессии для проверки access-токена без похода в БД.

    Реализация не бросает: при сбое хранилища `get` отвечает `None`
    (проверка идёт в БД), а запись молча теряется.
    """

    @abstractmethod
    async def get(self, session_id: uuid.UUID) -> bool | None:
        """`True`/`False` — закэшированный статус, `None` — в кэше нет."""
        ...

    @abstractmethod
    async def remember_active(self, session_id: uuid.UUID) -> None:
        """Кэширует «активна», не перетирая уже записанный отзыв."""
        ...

    @abstractmethod
    async def mark_revoked(self, session_ids: Iterable[uuid.UUID]) -> None:
        """Помечает сессии отозванными, чтобы токены перестали работать сразу."""
        ...
