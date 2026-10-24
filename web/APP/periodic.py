"""The 5-minute housekeeping loop, started from the FastAPI lifespan.

Every uvicorn worker runs the loop; a transaction-scoped Postgres advisory lock lets one
of them do each pass. Every step is an idempotent UPDATE or DELETE keyed on time, so a
pass that crashed halfway is finished by the next one.
"""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from APP.config import settings
from APP.logger import AppLogger
from APP.services.support_service import close_stale_resolved, resolve_idle_pending, utcnow

logger = AppLogger.get_logger()

# Arbitrary, fixed: "WDHK" (WatchDemo housekeeping).
LOCK_KEY = 0x5744484B

PeriodicStep = Callable[[AsyncSession, datetime], Awaitable[int]]

# Run in order inside one transaction. Each takes (session, now) and returns rows touched.
# Crash reports plug in here: append `purge_old_crash_reports` (delete reports older than
# 90 days, spec 3.3 step 3).
STEPS: list[PeriodicStep] = [
    close_stale_resolved,
    resolve_idle_pending,
]


async def run_once(session_factory: async_sessionmaker, now: datetime | None = None) -> dict[str, int] | None:
    """One pass. None when another worker holds the lock."""
    async with session_factory() as session, session.begin():
        if not await session.scalar(select(func.pg_try_advisory_xact_lock(LOCK_KEY))):
            return None
        now = now or utcnow()
        return {step.__name__: await step(session, now) for step in STEPS}


async def run_forever(session_factory: async_sessionmaker) -> None:
    while True:
        try:
            done = await run_once(session_factory)
            if done and any(done.values()):
                logger.info(f"periodic pass: {done}")
        except Exception:
            logger.exception("periodic pass failed")
        await asyncio.sleep(settings.support.periodic_interval_seconds)
