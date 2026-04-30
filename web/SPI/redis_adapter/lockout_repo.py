from redis.asyncio import Redis

from APP.ports.lockout_port import LockoutPort

_MAX_ATTEMPTS = 5
_LOCKOUT_SECONDS = 300  # 5 min
_ATTEMPT_WINDOW = 300


def _attempts_key(login: str) -> str:
    return f"login_attempts:{login}"


def _lock_key(login: str) -> str:
    return f"login_locked:{login}"


class RedisLockoutRepo(LockoutPort):
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def is_locked(self, login: str) -> tuple[bool, int]:
        ttl = await self._redis.ttl(_lock_key(login))
        if ttl > 0:
            return True, ttl
        return False, 0

    async def record_failure(self, login: str) -> tuple[int, bool]:
        key = _attempts_key(login)
        pipe = self._redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, _ATTEMPT_WINDOW)
        results = await pipe.execute()
        count: int = results[0]

        if count >= _MAX_ATTEMPTS:
            await self._redis.setex(_lock_key(login), _LOCKOUT_SECONDS, "1")
            await self._redis.delete(key)
            return count, True

        return count, False

    async def reset(self, login: str) -> None:
        await self._redis.delete(_attempts_key(login), _lock_key(login))
