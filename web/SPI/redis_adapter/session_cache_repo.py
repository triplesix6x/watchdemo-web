import uuid
from collections.abc import Iterable

from redis.asyncio import Redis
from redis.exceptions import RedisError

from APP.logger import AppLogger
from APP.ports.session_cache_port import SessionCachePort

logger = AppLogger.get_logger()

# Дольше 60 с отозванная сессия не проживёт, даже если отзыв не дошёл до кэша.
_TTL_SECONDS = 60


def _key(session_id: uuid.UUID) -> str:
    return f"session_active:{session_id}"


class RedisSessionCache(SessionCachePort):
    """Кэш best-effort: при недоступном Redis проверка уходит в БД, запись теряется."""

    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def get(self, session_id: uuid.UUID) -> bool | None:
        try:
            value = await self._redis.get(_key(session_id))
        except (RedisError, OSError) as e:
            logger.warning("session_cache: get failed, falling back to DB: %s", e)
            return None
        if value is None:
            return None
        return value == "1"

    async def remember_active(self, session_id: uuid.UUID) -> None:
        # NX: если параллельный отзыв уже записал «0», запрос, прочитавший БД
        # до коммита отзыва, не вернёт сессию к жизни.
        try:
            await self._redis.set(_key(session_id), "1", ex=_TTL_SECONDS, nx=True)
        except (RedisError, OSError) as e:
            logger.warning("session_cache: remember_active failed: %s", e)

    async def mark_revoked(self, session_ids: Iterable[uuid.UUID]) -> None:
        # Отзыв уже записан в БД; без Redis он сработает, как только истечёт
        # закэшированное «1» (не дольше _TTL_SECONDS).
        try:
            pipe = self._redis.pipeline()
            for session_id in session_ids:
                pipe.set(_key(session_id), "0", ex=_TTL_SECONDS)
            await pipe.execute()
        except (RedisError, OSError) as e:
            logger.warning("session_cache: mark_revoked failed: %s", e)
