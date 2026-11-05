"""Strict HTTP v1 behavior with in-process fakes; separate from crypto/DB tests.

Coordinator must bootstrap tests/conftest.py in-process before unittest loading,
so production dotenv files are never read. No real network is involved.
"""
import asyncio
import json
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import httpx
from fastapi import FastAPI
from pydantic import ValidationError

from APP.quota_contract import AccessSnapshot, FeatureAccess, GroupRequest, GroupResetRequest, OperationRequest, ReserveRequest, UsageOperation
from API.views.app.views import router
from APP.constants import SubscriptionTier
from APP.dependencies import AuthContext, get_current_auth, get_quota_service
from APP.exception_handlers import register_exception_handlers
from APP.exceptions import ConflictError, ErrorCode


def snapshot():
    return AccessSnapshot(server_time=datetime(2026, 1, 1, tzinfo=timezone.utc),
        tier=SubscriptionTier.BASIC, paid_cycle_anchor=None, subscription_expires_at=None,
        group_generation=3, features=[], lease=None)


class QuotaProtocolTests(unittest.TestCase):
    def test_strict_requests_bound_unique_ids_and_forbid_client_authority_or_content(self):
        library, oid = uuid.uuid4(), uuid.uuid4()
        for body in ({"tier": "pro"}, {"account_id": str(uuid.uuid4())}, {"now": "2026-01-01"},
                     {"path": "C:/private/demo.dem"}, {"remaining": 500}, {"name": "private"}):
            with self.subTest(body=body), self.assertRaises(ValidationError):
                ReserveRequest(library_id=library, kind="demo_import", operation_ids=[oid], **body)
        for ids in ([], [oid, oid], [uuid.uuid4() for _ in range(1001)]):
            with self.assertRaises(ValidationError):
                OperationRequest(library_id=library, operation_ids=ids)
        with self.assertRaises(ValidationError):
            ReserveRequest(library_id=library, kind="arbitrary", operation_ids=[oid])
        with self.assertRaises(ValidationError):
            GroupRequest(library_id=library, group_ids=[oid, oid])
        with self.assertRaises(ValidationError):
            GroupResetRequest(reason=" \n ")
        self.assertEqual(GroupResetRequest(reason=" actual inventory loss ").reason, "actual inventory loss")
        self.assertEqual(UsageOperation(operation_id=oid, kind=None, state="unknown", expires_at=None).model_dump(mode="json"), {
            "operation_id": str(oid), "kind": None, "state": "unknown", "expires_at": None})
        with self.assertRaises(ValidationError):
            UsageOperation(operation_id=oid, kind=None, state="reserved", expires_at=None)

    def test_shared_cross_language_operation_and_exhaustion_fixture(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/subscription_sync_boundary.json").read_text())
        for name in ("unknown_operation", "cancelled_before_reserve"):
            self.assertEqual(UsageOperation.model_validate(fixture[name]).model_dump(mode="json"), fixture[name])
        feature = FeatureAccess.model_validate(fixture["exhausted_custom_sets_feature"])
        self.assertTrue(feature.allowed)
        self.assertEqual(feature.remaining, 0)
        self.assertEqual(feature.monthly_limit, 1)
        self.assertIsNone(feature.limit)
        self.assertEqual(feature.scope, "account")

    def test_actual_snapshot_denied_and_unlimited_features_match_shared_shapes(self):
        from APP.services.quota_service import QuotaService

        fixture = json.loads((Path(__file__).parent / "fixtures/subscription_sync_boundary.json").read_text())

        class SnapshotRepository:
            async def counts(self, *args):
                return {("custom_sets", "committed"): 99, ("custom_sets", "reserved"): 2}

        async def run():
            now = datetime(2026, 3, 20, tzinfo=timezone.utc)
            service = QuotaService(SnapshotRepository())
            for tier, fixture_name, feature_id in (
                (SubscriptionTier.BASIC, "denied_uncapped_notes_feature", "notes"),
                (SubscriptionTier.PRO, "pro_unlimited_custom_sets_feature", "custom_sets"),
            ):
                anchor = datetime(2026, 3, 1, tzinfo=timezone.utc) if tier == SubscriptionTier.PRO else None
                context = (SimpleNamespace(group_generation=0), None, now, tier, anchor, None)
                result = await service._snapshot(uuid.uuid4(), uuid.uuid4(), context)
                feature = next(item for item in result.features if item.id == feature_id)
                self.assertEqual(feature.model_dump(mode="json"), fixture[fixture_name])

        asyncio.run(run())

    def test_quota_error_top_level_lowercase_snapshot_and_validation_unchanged(self):
        class FakeService:
            async def reserve(self, *args):
                raise ConflictError("Selected batch exceeds quota", code=ErrorCode.QUOTA_EXCEEDED,
                    access=snapshot().model_dump(mode="json"))

        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        register_exception_handlers(app)
        app.dependency_overrides[get_current_auth] = lambda: AuthContext(SimpleNamespace(id=uuid.uuid4()), uuid.uuid4())
        app.dependency_overrides[get_quota_service] = FakeService

        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                body = {"library_id": str(uuid.uuid4()), "kind": "demo_import", "operation_ids": [str(uuid.uuid4())]}
                response = await client.post("/api/v1/app/usage/reserve", json=body)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json(), {"message": "Selected batch exceeds quota", "code": "quota_exceeded", "access": snapshot().model_dump(mode="json")})
                invalid = await client.post("/api/v1/app/usage/reserve", json={**body, "path": "private"})
                self.assertEqual(invalid.status_code, 422)
                self.assertEqual(invalid.json()["code"], "validation_failed")
                self.assertIn("detail", invalid.json())
        asyncio.run(run())
