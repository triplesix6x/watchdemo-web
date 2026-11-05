"""Opt-in PostgreSQL behavioral tests; NEVER run by implementation workers.

Uses the existing migration fixture's exact disposable localhost QA allowlist,
random isolated schema, bounded pool/timeouts and no shared-table truncation.
Coordinator must separately approve contained serial execution and migrations.
"""
import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic import command
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from APP.constants import SubscriptionTier
from APP.exceptions import ConflictError, ErrorCode, PermissionDeniedError
from APP.services.quota_service import QuotaService
from SPI.db_adapter.models.audit_log import AuditLogModel
from SPI.db_adapter.models.quota import UsageOperationModel
from SPI.db_adapter.models.subscription import SubscriptionModel
from SPI.db_adapter.models.user import UserModel
from SPI.db_adapter.repositories.quota_repo import QuotaRepository
from SPI.db_adapter.repositories.subscription_repo import SubscriptionRepository
from test_migration_history import DB_URL, schema  # noqa: F401; guarded isolated fixture

NOW = datetime(2026, 3, 20, 12, tzinfo=timezone.utc)
SID = uuid.UUID("00000000-0000-4000-8000-000000000099")


def database(schema, scenario):
    command.upgrade(schema.cfg, "head")
    name = schema.execute("SELECT current_schema() AS name")[0]["name"]

    async def run():
        engine = create_async_engine(DB_URL, pool_size=3, max_overflow=0, connect_args={
            "server_settings": {"search_path": name, "lock_timeout": "3000", "statement_timeout": "5000"}})
        try:
            await scenario(async_sessionmaker(engine, expire_on_commit=False))
        finally:
            await engine.dispose()
    asyncio.run(run())


async def add_user(sm, role="user"):
    uid = uuid.uuid4()
    async with sm() as session, session.begin():
        session.add(UserModel(id=uid, email=f"{uid}@example.invalid", username=uid.hex,
            password_hash="test-only", role=role, is_active=True))
    return uid


async def subscription(sm, user, tier, anchor=NOW, expiry=None):
    async with sm() as session, session.begin():
        sub = await session.scalar(select(SubscriptionModel).where(SubscriptionModel.user_id == user))
        if sub is None:
            session.add(SubscriptionModel(user_id=user, tier=tier, started_at=anchor, expires_at=expiry))
        else:
            sub.tier, sub.started_at, sub.expires_at = tier, anchor, expiry


async def call(sm, user, library, method, *args, now=NOW):
    async with sm() as session, session.begin():
        service = QuotaService(QuotaRepository(session), clock=lambda: now)
        return await getattr(service, method)(user, SID, library, *args)


def feature(snapshot, kind):
    return next(f for f in snapshot.features if f.id == kind)


async def committed(sm, user, library, kind, count=1, now=NOW):
    ids = [uuid.uuid4() for _ in range(count)]
    await call(sm, user, library, "reserve", kind, ids, now=now)
    await call(sm, user, library, "transition", ids, "commit", now=now)
    return ids


def test_reserve_atomic_batch_concurrent_last_slot_and_durable_response_loss(schema):
    async def run(sm):
        user, library = await add_user(sm), uuid.uuid4()
        await committed(sm, user, library, "demo_import", 4)
        batch = [uuid.uuid4(), uuid.uuid4()]
        with pytest.raises(ConflictError) as error:
            await call(sm, user, library, "reserve", "demo_import", batch)
        assert error.value.code == ErrorCode.QUOTA_EXCEEDED
        assert feature(SimpleNamespace(features=[SimpleNamespace(**f) for f in error.value.extra["access"]["features"]]), "demo_import").remaining == 1
        # Failed all-or-none reservation did not bind either ID.
        status = await call(sm, user, library, "transition", batch, "status")
        assert [op.state for op in status.operations] == ["unknown", "unknown"]
        contenders = [uuid.uuid4(), uuid.uuid4()]
        results = await asyncio.gather(*(call(sm, user, library, "reserve", "demo_import", [oid]) for oid in contenders), return_exceptions=True)
        assert sum(isinstance(r, ConflictError) for r in results) == 1
        winner = next(r.operations[0].operation_id for r in results if not isinstance(r, Exception))
        # New service/session simulates restart/commit response loss.
        first = await call(sm, user, library, "transition", [winner], "commit")
        second = await call(sm, user, library, "transition", [winner], "commit")
        cancelled = await call(sm, user, library, "transition", [winner], "cancel")
        assert first.operations == second.operations == cancelled.operations
        assert feature(cancelled.access, "demo_import").used == 5
        assert feature(cancelled.access, "demo_import").reserved == 0
    database(schema, run)


def test_unknown_cancellation_tombstone_expiry_and_identity_binding(schema):
    async def run(sm):
        user, other, library = await add_user(sm), await add_user(sm), uuid.uuid4()
        oid = uuid.uuid4()
        unknown = await call(sm, user, library, "transition", [oid], "status")
        assert unknown.operations[0].state == "unknown" and unknown.operations[0].kind is None
        with pytest.raises(ConflictError):
            await call(sm, user, library, "transition", [oid], "commit")
        cancelled = await call(sm, user, library, "transition", [oid], "cancel")
        assert cancelled.operations[0].state == "cancelled" and cancelled.operations[0].kind is None
        delayed = await call(sm, user, library, "reserve", "demo_import", [oid])
        assert delayed.operations[0].state == "cancelled"
        assert feature(delayed.access, "demo_import").reserved == 0
        live = uuid.uuid4()
        await call(sm, user, library, "reserve", "demo_import", [live])
        with pytest.raises(ConflictError) as error:
            await call(sm, user, library, "reserve", "custom_sets", [live])
        assert error.value.code == ErrorCode.OPERATION_CONFLICT
        with pytest.raises(ConflictError):
            await call(sm, user, uuid.uuid4(), "transition", [live], "status")
        with pytest.raises(ConflictError):
            await call(sm, other, library, "access")
        at_expiry = NOW + timedelta(minutes=15)
        with pytest.raises(ConflictError) as error:
            await call(sm, user, library, "transition", [live], "commit", now=at_expiry)
        assert error.value.code == ErrorCode.QUOTA_RESERVATION_EXPIRED
        expired = await call(sm, user, library, "transition", [live], "status", now=at_expiry)
        assert expired.operations[0].state == "expired"
        assert feature(expired.access, "demo_import").reserved == 0
        # Unknown status is ephemeral, cancellation alone creates a durable row.
        fresh = uuid.uuid4()
        await call(sm, user, library, "transition", [fresh], "status")
        async with sm() as session:
            assert await session.get(UsageOperationModel, (user, fresh)) is None
    database(schema, run)


def test_monthly_sets_account_global_no_refund_and_rollover_reservation_timestamp(schema):
    async def run(sm):
        user, first, second = await add_user(sm), uuid.uuid4(), uuid.uuid4()
        fixture = json.loads((Path(__file__).parent / "fixtures/subscription_sync_boundary.json").read_text())["metering_boundary"]
        before = datetime.fromisoformat(fixture["reserved_at"])
        after = datetime.fromisoformat(fixture["committed_at"])
        oid = uuid.uuid4()
        await call(sm, user, first, "reserve", "custom_sets", [oid], now=before)
        with pytest.raises(ConflictError):
            await call(sm, user, second, "reserve", "custom_sets", [uuid.uuid4()], now=before)
        result = await call(sm, user, first, "transition", [oid], "commit", now=after)
        assert feature(result.access, "custom_sets").used == fixture["used_in_commit_month"]
        assert feature(result.access, "custom_sets").remaining == fixture["remaining_in_commit_month"]
        async with sm() as session:
            row = await session.get(UsageOperationModel, (user, oid))
            assert row.reserved_at == before and row.committed_at == after
            assert row.period_start == datetime.fromisoformat(fixture["period_start"])
            assert row.period_end == datetime.fromisoformat(fixture["period_end"])
            assert row.expires_at == datetime.fromisoformat(fixture["expires_at"])
        await committed(sm, user, second, "custom_sets", now=after)
        replay = await call(sm, user, first, "transition", [oid], "cancel", now=after)
        assert replay.operations[0].state == "committed"
        assert feature(replay.access, "custom_sets").used == 1
        with pytest.raises(ConflictError):
            await call(sm, user, first, "reserve", "custom_sets", [uuid.uuid4()], now=after)
    database(schema, run)


def test_initial_paid_activation_pro_plus_and_free_downgrade_counting(schema):
    async def run(sm):
        user, library = await add_user(sm), uuid.uuid4()
        pre = NOW - timedelta(days=2)
        await committed(sm, user, library, "demo_import", 3, now=pre)
        anchor = NOW - timedelta(days=1)
        await subscription(sm, user, "plus", anchor)
        paid = await call(sm, user, library, "access")
        assert feature(paid, "demo_import").used == 0
        await committed(sm, user, library, "demo_import", 2)
        await subscription(sm, user, "pro", anchor)
        unlimited = await call(sm, user, library, "access")
        assert feature(unlimited, "demo_import").remaining is None
        await committed(sm, user, library, "demo_import", 4)
        await subscription(sm, user, "plus", anchor)
        plus = await call(sm, user, library, "access")
        assert feature(plus, "demo_import").used == 6 and feature(plus, "demo_import").remaining == 9
        await subscription(sm, user, "basic", anchor)
        free = await call(sm, user, library, "access")
        assert feature(free, "demo_import").used == 9 and feature(free, "demo_import").remaining == 0
        # Exact expiry must expose Free regardless of stored paid tier.
        await subscription(sm, user, "plus", anchor, NOW)
        assert (await call(sm, user, library, "access")).tier == SubscriptionTier.BASIC
    database(schema, run)


def test_groups_additive_multilibrary_reset_restore_and_tombstone_replay(schema):
    async def run(sm):
        user, staff = await add_user(sm), await add_user(sm, "support")
        actor = SimpleNamespace(id=staff, role="support")
        a, b = uuid.uuid4(), uuid.uuid4()
        first, second, third = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        with pytest.raises(ConflictError) as error:
            await call(sm, user, a, "reserve", "demo_groups", [third])
        assert error.value.code == ErrorCode.LIBRARY_RECONCILIATION_REQUIRED
        await call(sm, user, a, "reconcile", [first], None)
        summed = await call(sm, user, b, "reconcile", [second], 0)
        assert feature(summed.access, "demo_groups").used == 2
        # Additive empty inventory never removes existing IDs.
        additive = await call(sm, user, a, "reconcile", [], 0)
        assert feature(additive.access, "demo_groups").used == 2
        with pytest.raises(ConflictError):
            await call(sm, user, a, "reserve", "demo_groups", [third])
        deleted = await call(sm, user, a, "delete_groups", [first])
        assert feature(deleted.access, "demo_groups").used == 1
        await call(sm, user, a, "delete_groups", [first])
        # Reconcile cannot replay deleted identities into counted inventory.
        assert feature((await call(sm, user, a, "reconcile", [first], 0)).access, "demo_groups").used == 1
        await call(sm, user, a, "reserve", "demo_groups", [third])
        async with sm() as session, session.begin():
            reset = await QuotaService(QuotaRepository(session), lambda: NOW).reset_groups(actor, user, "lost device")
        assert reset.generation == 1 and reset.removed_groups == 1 and reset.cancelled_reservations == 1
        with pytest.raises(ConflictError):
            await call(sm, user, a, "transition", [third], "commit")
        with pytest.raises(ConflictError):
            await call(sm, user, a, "reserve", "demo_groups", [uuid.uuid4()])
        for stale in (None, 0):
            with pytest.raises(ConflictError):
                await call(sm, user, b, "reconcile", [second], stale)
        # Returning actual inventory can exceed cap; it is not silently deleted.
        restored = await call(sm, user, b, "reconcile", [second, uuid.uuid4(), uuid.uuid4()], 1)
        assert feature(restored.access, "demo_groups").used == 3
        assert feature(restored.access, "demo_groups").remaining == 0
        async with sm() as session:
            audit = await session.scalar(select(AuditLogModel).where(AuditLogModel.action == "reset_group_inventory"))
            assert audit.actor_id == staff and audit.target_user_id == user
            assert audit.details["reason"] == "lost device" and audit.details["generation"] == 1
        # A delayed old deletion applies to exact ID without touching new groups.
        final = await call(sm, user, b, "delete_groups", [second])
        assert feature(final.access, "demo_groups").used == 2
    database(schema, run)


@pytest.mark.parametrize("actor_role,target_role,self_target,allowed", [
    ("user", "user", False, False), ("support", "user", False, True),
    ("support", "support", False, False), ("support", "moderator", False, False),
    ("admin", "admin", False, True), ("admin", "admin", True, False),
])
def test_support_reset_strict_roles_and_does_not_reset_monthly_usage(schema, actor_role, target_role, self_target, allowed):
    async def run(sm):
        actor_id = await add_user(sm, actor_role)
        target = actor_id if self_target else await add_user(sm, target_role)
        library = uuid.uuid4()
        await committed(sm, target, library, "demo_import")
        await committed(sm, target, library, "custom_sets")
        async def reset():
            async with sm() as session, session.begin():
                return await QuotaService(QuotaRepository(session), lambda: NOW).reset_groups(
                    SimpleNamespace(id=actor_id, role=actor_role), target, "inventory reset")
        if allowed:
            await reset()
        else:
            with pytest.raises(PermissionDeniedError):
                await reset()
        access = await call(sm, target, library, "access")
        assert feature(access, "demo_import").used == 1
        assert feature(access, "custom_sets").used == 1
        assert access.tier == SubscriptionTier.BASIC
    database(schema, run)


def test_subscription_regrant_extension_switch_preserve_anchor_and_expiry_restarts(schema, monkeypatch):
    from SPI.db_adapter.repositories import subscription_repo

    async def run(sm):
        user, staff = await add_user(sm), await add_user(sm, "admin")
        current = [NOW]
        monkeypatch.setattr(subscription_repo, "datetime", SimpleNamespace(now=lambda **kw: current[0]))
        async def grant(tier, expiry):
            async with sm() as session, session.begin():
                return await SubscriptionRepository(session).upsert(user, tier, expiry, staff)
        expiry = NOW + timedelta(days=60)
        first = await grant(SubscriptionTier.PLUS, expiry)
        current[0] += timedelta(days=2)
        again = await grant(SubscriptionTier.PLUS, expiry + timedelta(days=2))
        pro = await grant(SubscriptionTier.PRO, expiry)
        plus = await grant(SubscriptionTier.PLUS, expiry)
        assert first.started_at == again.started_at == pro.started_at == plus.started_at == NOW
        async with sm() as session, session.begin():
            extended = await SubscriptionRepository(session).set_expiry(user, expiry + timedelta(days=5), staff)
        assert extended.started_at == NOW
        current[0] = expiry + timedelta(days=5)
        renewed = await grant(SubscriptionTier.PLUS, current[0] + timedelta(days=30))
        assert renewed.started_at == current[0]
        await grant(SubscriptionTier.BASIC, None)
        current[0] += timedelta(seconds=1)
        renewed_after_revoke = await grant(SubscriptionTier.PLUS, None)
        assert renewed_after_revoke.started_at == current[0]
    database(schema, run)
