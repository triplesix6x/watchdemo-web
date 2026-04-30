from abc import ABC, abstractmethod


class LockoutPort(ABC):
    @abstractmethod
    async def is_locked(self, login: str) -> tuple[bool, int]:
        """Returns (is_locked, retry_after_seconds)."""
        ...

    @abstractmethod
    async def record_failure(self, login: str) -> tuple[int, bool]:
        """Increments failure counter. Returns (attempt_count, is_now_locked)."""
        ...

    @abstractmethod
    async def reset(self, login: str) -> None:
        """Clears failure counter and lock for this login."""
        ...
