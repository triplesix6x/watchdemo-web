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
from APP.services.crash_service import purge_old_crash_reports
from APP.legal_catalog import load_catalog
from APP.services.legal_service import LegalService, publish_pending_notifications, purge_expired_legal_evidence
from SPI.mq_adapter.publisher import MQPublisher
from APP.services.support_service import close_stale_resolved, resolve_idle_pending, utcnow

logger = AppLogger.get_logger()

# Arbitrary, fixed: "WDHK" (WatchDemo housekeeping).
LOCK_KEY = 0x5744484B

PeriodicStep = Callable[[AsyncSession, datetime], Awaitable[int]]

# Run in order inside one transaction. Each takes (session, now) and returns rows touched.
STEPS: list[PeriodicStep] = [
    close_stale_resolved,
    resolve_idle_pending,
    purge_old_crash_reports,
    purge_expired_legal_evidence,
]


async def run_once(session_factory: async_sessionmaker, now: datetime | None = None) -> dict[str, int] | None:
    """One pass. None when another worker holds the lock."""
    async with session_factory() as session, session.begin():
        if not await session.scalar(select(func.pg_try_advisory_xact_lock(LOCK_KEY))):
            return None
        now = now or utcnow()
        return {step.__name__: await step(session, now) for step in STEPS}


async def reconcile_legal(session_factory: async_sessionmaker) -> None:
    catalog = load_catalog()
    # A draft has no readiness request or activation writes.
    if not catalog.effective_documents:
        return
    async with session_factory() as session, session.begin():
        await LegalService(session, catalog).reconcile()


async def publish_legal_outbox(session_factory: async_sessionmaker, publisher: MQPublisher) -> None:
    # Drain the backlog before the five-minute housekeeping sleep. Commit each
    # bounded batch so locks and already-published progress are released promptly.
    while True:
        async with session_factory() as session, session.begin():
            consumed = await publish_pending_notifications(session, publisher)
        if consumed < 100:
            return


async def run_forever(session_factory: async_sessionmaker, publisher: MQPublisher) -> None:
    # First pass is immediate at startup; every worker can run it safely.
    while True:
        try:
            await reconcile_legal(session_factory)
        except Exception:
            logger.exception("legal reconciliation failed; signup stays on DB policy or fails closed")
        try:
            # An unready newer bundle must not prevent publishing already committed jobs.
            await publish_legal_outbox(session_factory, publisher)
        except Exception as exc:
            # Broker exceptions can include serialized recipient/message contents.
            logger.error("legal outbox publication failed; pending jobs retained error_type=%s",
                         type(exc).__name__)
        try:
            done = await run_once(session_factory)
            if done and any(done.values()):
                logger.info(f"periodic pass: {done}")
        except Exception:
            logger.exception("periodic pass failed")
        await asyncio.sleep(settings.support.periodic_interval_seconds)
