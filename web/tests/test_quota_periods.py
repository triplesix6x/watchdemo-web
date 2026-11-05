"""Pure calendar behavior; stdlib-only and separate from crypto/DB tests."""
import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

from APP.quota_periods import quota_period


def utc(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


class QuotaPeriodTests(unittest.TestCase):
    def test_calendar_original_anchor_and_exact_boundary(self):
        cases = [
            (None, "2024-02-29T23:59:59", "2024-02-01T00:00:00", "2024-03-01T00:00:00"),
            (None, "2026-12-31T23:59:59", "2026-12-01T00:00:00", "2027-01-01T00:00:00"),
            ("2024-01-31T12:34:56", "2024-02-29T12:34:55", "2024-01-31T12:34:56", "2024-02-29T12:34:56"),
            ("2024-01-31T12:34:56", "2024-02-29T12:34:56", "2024-02-29T12:34:56", "2024-03-31T12:34:56"),
            ("2025-01-31T12:34:56", "2025-03-30T12:34:56", "2025-02-28T12:34:56", "2025-03-31T12:34:56"),
            ("2025-01-31T12:34:56", "2025-03-31T12:34:56", "2025-03-31T12:34:56", "2025-04-30T12:34:56"),
        ]
        for anchor, now, start, end in cases:
            with self.subTest(anchor=anchor, now=now):
                self.assertEqual(quota_period(utc(now), utc(anchor) if anchor else None), (utc(start), utc(end)))

    def test_shared_cross_language_boundary_fixture(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/subscription_sync_boundary.json").read_text())
        for case in fixture["calendar_cases"]:
            with self.subTest(case=case):
                self.assertEqual(quota_period(utc(case["now"]), utc(case["anchor"]) if case["anchor"] else None),
                    (utc(case["start"]), utc(case["end"])))
