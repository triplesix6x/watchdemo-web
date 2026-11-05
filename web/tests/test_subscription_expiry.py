"""Actual subscription entity boundary behavior; no database or network."""
from datetime import datetime, timedelta, timezone
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

import APP.entities.subscription as subscription_module
from APP.constants import SubscriptionTier


class SubscriptionExpiryTests(TestCase):
    def test_before_exact_after_and_indefinite_expiry_for_every_tier(self):
        now = datetime(2026, 11, 5, tzinfo=timezone.utc)
        for tier in SubscriptionTier:
            for offset in (-1, 0, 1, None):
                with self.subTest(tier=tier, microseconds_until_expiry=offset):
                    entity = subscription_module.SubscriptionEntity(
                        id=uuid4(), user_id=uuid4(), tier=tier,
                        started_at=now - timedelta(days=1),
                        expires_at=None if offset is None else now + timedelta(microseconds=offset),
                        granted_by=None,
                    )
                    with patch.object(subscription_module, "datetime") as clock:
                        clock.now.return_value = now
                        expired = offset is not None and offset <= 0
                        expected_tier = SubscriptionTier.BASIC if expired else tier
                        self.assertEqual(entity.effective_tier, expected_tier)
                        self.assertEqual(entity.is_expired, expired)
