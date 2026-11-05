"""Transactional account-global quota protocol; request dependency commits atomically."""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from APP.quota_contract import AccessSnapshot, FeatureAccess, GroupResetResponse, GroupResponse, UsageOperation, UsageResponse
from APP.config import settings
from APP.constants import SubscriptionTier, UserRole, role_level
from APP.exceptions import ConflictError, ErrorCode, PermissionDeniedError, ValidationError
from APP.quota_periods import quota_period
from APP.services.admin_service import check_target
from APP.services.entitlement_service import sign_entitlement
from APP.tiers import FEATURE_MIN_TIER, MONTHLY_LIMITS, QUANTITY_LIMITS, TIER_ORDER
from SPI.db_adapter.models.quota import UsageOperationModel
from SPI.db_adapter.models.subscription import SubscriptionModel
from SPI.db_adapter.repositories.audit_log_repo import AuditLogRepository
from SPI.db_adapter.repositories.quota_repo import QuotaRepository
from SPI.db_adapter.repositories.user_repo import UserRepository


class QuotaService:
    def __init__(self, repo: QuotaRepository, clock=None):
        self.repo = repo
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    async def _context(self, user_id, library_id):
        account = await self.repo.lock_account(user_id)
        # Time is sampled after the lock: waiting requests never authorize using
        # a stale pre-lock subscription/expiry timestamp.
        now = self.clock()
        library = await self.repo.library(user_id, library_id)
        await self.repo.expire(user_id, now)
        # Authentication may have eagerly loaded this subscription before the
        # lock wait. Refresh ORM identity-map attributes after acquiring the lock.
        sub = await self.repo.session.scalar(select(SubscriptionModel)
            .where(SubscriptionModel.user_id == user_id).execution_options(populate_existing=True))
        tier = SubscriptionTier.BASIC
        anchor = None
        expiry = sub.expires_at if sub else None
        if sub and sub.is_active and (expiry is None or now < expiry):
            tier = SubscriptionTier(sub.tier)
            if tier != SubscriptionTier.BASIC:
                anchor = sub.started_at
        return account, library, now, tier, anchor, expiry

    async def _snapshot(self, user_id, session_id, ctx):
        account, _, now, tier, anchor, expiry = ctx
        start, end = quota_period(now, anchor)
        counts = await self.repo.counts(user_id, now, start, end, anchor, account.group_generation)
        features = []
        for feature, min_tier in FEATURE_MIN_TIER.items():
            used = counts.get((feature, "committed"), 0)
            reserved = counts.get((feature, "reserved"), 0)
            monthly = MONTHLY_LIMITS.get((feature, tier))
            quantity = QUANTITY_LIMITS.get((feature, tier))
            cap = monthly if monthly is not None else quantity
            allowed = TIER_ORDER.index(tier) >= TIER_ORDER.index(min_tier)
            features.append(FeatureAccess(
                id=feature, allowed=allowed, min_tier=min_tier,
                monthly_limit=monthly, limit=quantity,
                limit_period=("calendar_month" if anchor is None else "activation_month") if monthly is not None else None,
                used=used, reserved=reserved,
                remaining=max(0, cap - used - reserved) if cap is not None else (None if allowed else 0),
                resets_at=end if feature in ("demo_import", "custom_sets") else None,
            ))
        return AccessSnapshot(server_time=now, tier=tier, paid_cycle_anchor=anchor,
            subscription_expires_at=expiry, group_generation=account.group_generation,
            features=features, lease=sign_entitlement(settings.entitlement, user_id=user_id,
                session_id=session_id, tier=tier, now=now, anchor=anchor, subscription_expires_at=expiry))

    async def access(self, user_id, session_id, library_id):
        ctx = await self._context(user_id, library_id)
        return await self._snapshot(user_id, session_id, ctx)

    async def _conflict(self, code, user_id, session_id, ctx, message):
        access = await self._snapshot(user_id, session_id, ctx)
        raise ConflictError(message, code=code, access=access.model_dump(mode="json"))

    @staticmethod
    def _bound(operations, library_id, kind=None):
        if any(op.library_id != library_id or (kind is not None and op.kind is not None and op.kind != kind) for op in operations):
            raise ConflictError("Operation identity is permanently bound", code=ErrorCode.OPERATION_CONFLICT)

    async def _envelope(self, user_id, session_id, ctx, ids):
        await self.repo.session.flush()
        operations = {op.operation_id: op for op in await self.repo.operations(user_id, ids)}
        return UsageResponse(operations=[UsageOperation(operation_id=oid,
            kind=operations[oid].kind if oid in operations else None,
            state=operations[oid].state if oid in operations else "unknown",
            expires_at=operations[oid].expires_at if oid in operations else None) for oid in ids],
            access=await self._snapshot(user_id, session_id, ctx))

    async def reserve(self, user_id, session_id, library_id, kind, ids):
        ctx = await self._context(user_id, library_id)
        account, library, now, _, anchor, _ = ctx
        existing = await self.repo.operations(user_id, ids)
        self._bound(existing, library_id, kind)
        known = {op.operation_id for op in existing}
        new = [oid for oid in ids if oid not in known]
        if new and kind == "demo_groups" and library.reconciled_generation != account.group_generation:
            await self._conflict(ErrorCode.LIBRARY_RECONCILIATION_REQUIRED, user_id, session_id, ctx, "Reconcile actual library groups before creation")
        snapshot = await self._snapshot(user_id, session_id, ctx)
        feature = next(f for f in snapshot.features if f.id == kind)
        if feature.remaining is not None and len(new) > feature.remaining:
            raise ConflictError("Selected batch exceeds quota", code=ErrorCode.QUOTA_EXCEEDED, access=snapshot.model_dump(mode="json"))
        start, end = quota_period(now, anchor)
        for oid in new:
            self.repo.session.add(UsageOperationModel(user_id=user_id, operation_id=oid, library_id=library_id,
                kind=kind, state="reserved", reserved_at=now, period_start=start, period_end=end,
                paid_cycle_anchor=anchor, expires_at=now + timedelta(minutes=15),
                group_generation=account.group_generation, group_deleted=False))
        return await self._envelope(user_id, session_id, ctx, ids)

    async def transition(self, user_id, session_id, library_id, ids, action):
        ctx = await self._context(user_id, library_id)
        account, library, now, *_ = ctx
        operations = await self.repo.operations(user_id, ids)
        self._bound(operations, library_id)
        if len(operations) != len(ids) and action == "commit":
            raise ConflictError("Unknown operation identity", code=ErrorCode.OPERATION_CONFLICT)
        if action == "cancel":
            known = {op.operation_id for op in operations}
            start, end = quota_period(now, ctx[4])
            for oid in ids:
                if oid not in known:
                    self.repo.session.add(UsageOperationModel(user_id=user_id, operation_id=oid,
                        library_id=library_id, kind=None, state="cancelled", reserved_at=now,
                        period_start=start, period_end=end, paid_cycle_anchor=ctx[4], expires_at=None,
                        group_generation=account.group_generation, group_deleted=False))
        # Validate the entire batch before changing any row.
        if action == "commit":
            if any(op.state == "expired" for op in operations):
                await self._conflict(ErrorCode.QUOTA_RESERVATION_EXPIRED, user_id, session_id, ctx, "Reservation expired")
            if any(op.state == "cancelled" for op in operations):
                raise ConflictError("Cancelled operation cannot commit", code=ErrorCode.OPERATION_CONFLICT)
            if any(op.kind == "demo_groups" and op.state == "reserved" and (
                op.group_generation != account.group_generation or library.reconciled_generation != account.group_generation
            ) for op in operations):
                await self._conflict(ErrorCode.LIBRARY_RECONCILIATION_REQUIRED, user_id, session_id, ctx, "Group inventory was reset")
        for op in operations:
            if op.state == "reserved":
                if action == "commit":
                    op.state = "committed"
                    op.committed_at = now
                elif action == "cancel":
                    op.state = "cancelled"
        return await self._envelope(user_id, session_id, ctx, ids)

    async def reconcile(self, user_id, session_id, library_id, ids, generation):
        ctx = await self._context(user_id, library_id)
        account, library, now, _, anchor, _ = ctx
        if generation != account.group_generation and not (generation is None and account.group_generation == 0):
            await self._conflict(ErrorCode.LIBRARY_RECONCILIATION_REQUIRED, user_id, session_id, ctx, "Reconcile using current generation and actual local inventory")
        existing = await self.repo.operations(user_id, ids)
        self._bound(existing, library_id, "demo_groups")
        # Reconciliation restores committed inventory only; it must not turn an
        # expired/cancelled or still-staged operation into publication permission.
        if any(op.state != "committed" for op in existing):
            raise ConflictError("Group identity is not committed", code=ErrorCode.OPERATION_CONFLICT)
        known = {op.operation_id for op in existing}
        for op in existing:
            if not op.group_deleted:
                op.group_generation = account.group_generation
        start, end = quota_period(now, anchor)
        for oid in ids:
            if oid not in known:
                self.repo.session.add(UsageOperationModel(user_id=user_id, operation_id=oid, library_id=library_id,
                    kind="demo_groups", state="committed", reserved_at=now, committed_at=now,
                    period_start=start, period_end=end, paid_cycle_anchor=anchor,
                    expires_at=None, group_generation=account.group_generation, group_deleted=False))
        library.reconciled_generation = account.group_generation
        await self.repo.session.flush()
        return GroupResponse(generation=account.group_generation, access=await self._snapshot(user_id, session_id, ctx))

    async def delete_groups(self, user_id, session_id, library_id, ids):
        ctx = await self._context(user_id, library_id)
        account, _, now, _, anchor, _ = ctx
        existing = await self.repo.operations(user_id, ids)
        self._bound(existing, library_id, "demo_groups")
        for op in existing:
            op.group_deleted = True
            if op.state == "reserved":
                op.state = "cancelled"
        # Unknown offline legacy deletions get permanent tombstones too, so a
        # delayed additive reconcile cannot reintroduce an explicitly deleted ID.
        known = {op.operation_id for op in existing}
        start, end = quota_period(now, anchor)
        for oid in ids:
            if oid not in known:
                self.repo.session.add(UsageOperationModel(user_id=user_id, operation_id=oid, library_id=library_id,
                    kind="demo_groups", state="committed", reserved_at=now, committed_at=now,
                    period_start=start, period_end=end, paid_cycle_anchor=anchor, expires_at=None,
                    group_generation=account.group_generation, group_deleted=True))
        await self.repo.session.flush()
        return GroupResponse(generation=account.group_generation, access=await self._snapshot(user_id, session_id, ctx))

    async def reset_groups(self, actor, user_id, reason, ip_address=None):
        if role_level(UserRole(actor.role)) < role_level(UserRole.SUPPORT):
            raise PermissionDeniedError("Insufficient permissions", code=ErrorCode.INSUFFICIENT_ROLE)
        if not reason.strip():
            raise ValidationError("Reason must not be blank", code=ErrorCode.VALIDATION_FAILED)
        account = await self.repo.lock_account(user_id)
        target = await UserRepository(self.repo.session).get_by_id(user_id)
        check_target(actor, target, "strict")
        now = self.clock()
        await self.repo.expire(user_id, now)
        groups = await self.repo.operations(user_id, kind="demo_groups")
        removed = sum(op.state == "committed" and not op.group_deleted and op.group_generation == account.group_generation for op in groups)
        cancelled = 0
        for op in groups:
            if op.state == "reserved":
                op.state = "cancelled"
                cancelled += 1
        previous = account.group_generation
        account.group_generation += 1
        await AuditLogRepository(self.repo.session).log(actor_id=actor.id, action="reset_group_inventory",
            target_user_id=user_id, ip_address=ip_address, details={"reason": reason.strip(),
                "at": now.isoformat(), "previous_generation": previous,
                "generation": account.group_generation, "removed_groups": removed,
                "cancelled_reservations": cancelled})
        return GroupResetResponse(generation=account.group_generation, removed_groups=removed, cancelled_reservations=cancelled)
