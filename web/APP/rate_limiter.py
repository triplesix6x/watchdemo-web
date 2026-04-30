import asyncio
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class SlidingWindowRateLimiter:
    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self._max = max_requests
        self._window = window_seconds
        self._records: dict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def is_allowed(self, key: str) -> bool:
        async with self._lock:
            now = time.monotonic()
            cutoff = now - self._window
            bucket = self._records[key]
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= self._max:
                return False
            bucket.append(now)
            return True


def _get_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def make_rate_limit_dep(limiter: SlidingWindowRateLimiter):
    async def _dep(request: Request) -> None:
        if not await limiter.is_allowed(_get_ip(request)):
            raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")
    return _dep


# Shared limiter instances
_login_limiter = SlidingWindowRateLimiter(max_requests=10, window_seconds=60)
_register_limiter = SlidingWindowRateLimiter(max_requests=5, window_seconds=60)
_password_limiter = SlidingWindowRateLimiter(max_requests=5, window_seconds=60)
_token_limiter = SlidingWindowRateLimiter(max_requests=20, window_seconds=60)

login_rate_limit = make_rate_limit_dep(_login_limiter)
register_rate_limit = make_rate_limit_dep(_register_limiter)
password_rate_limit = make_rate_limit_dep(_password_limiter)
token_rate_limit = make_rate_limit_dep(_token_limiter)
