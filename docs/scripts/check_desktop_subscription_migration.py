"""Exercise actual desktop SQLite migrations in memory; never open a user database.

This validates SQL and trigger behavior with Python's SQLite, not Rust/sqlx recovery.
Run through run_limited_check_windows.py. No application imports or network.
"""
import argparse
import json
from pathlib import Path
import sqlite3
import sys
import unittest


class SubscriptionMigrationTests(unittest.TestCase):
    migration_dir: Path

    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.execute("PRAGMA foreign_keys=ON")
        migrations = sorted(self.migration_dir.glob("*.sql"))
        self.assertEqual(len(migrations), 12, "Review this probe when migration history changes")
        self.assertEqual(migrations[10].name, "011_subscription.sql")
        self.assertEqual(migrations[11].name, "012_subscription_batch_denials.sql")
        for migration in migrations[:10]:
            self.db.executescript(migration.read_text(encoding="utf-8"))
        self.db.execute("INSERT INTO demos(id,file_path,display_name,file_size,added_at) VALUES(?,?,?,?,?)",
                        ("demo-fixture", "fixture.dem", "Local fixture", 1, "2026-01-01T00:00:00Z"))
        self.db.execute("INSERT INTO groups VALUES(?,?,?)", ("group-fixture", "Existing", "2026-01-01T00:00:00Z"))
        self.db.execute("INSERT INTO moment_sets(id,demo_id,name,kind,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                        ("set-fixture", "demo-fixture", "Existing set", "manual", "2026-01-01", "2026-01-01"))
        self.db.commit()
        for migration in migrations[10:]:
            self.db.executescript(migration.read_text(encoding="utf-8"))

    def pending(self, payload):
        self.db.execute("INSERT INTO subscription_journal VALUES(?,?,?,?,?,?)",
                        ("operation-fixture", "batch-fixture", json.dumps(payload), "fixture-fingerprint", "pending", "2026-01-01"))

    def test_migration_preserves_existing_catalog_without_retroactive_usage(self):
        for table in ("demos", "groups", "moment_sets"):
            with self.subTest(table=table):
                self.assertEqual(self.db.execute(f"SELECT count(*) FROM {table}").fetchone()[0], 1)
        self.assertEqual(self.db.execute("SELECT count(*) FROM subscription_journal").fetchone()[0], 0)
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_group_deletion_retains_original_id_until_server_sync(self):
        self.db.execute("DELETE FROM groups WHERE id=?", ("group-fixture",))
        self.assertEqual(self.db.execute("SELECT group_id FROM subscription_group_tombstones").fetchall(), [("group-fixture",)])

    def test_pending_set_blocks_demo_deletion_until_publication(self):
        self.pending({"object": "set", "demo_id": "demo-fixture"})
        with self.assertRaisesRegex(sqlite3.IntegrityError, "subscription operation pending"):
            self.db.execute("DELETE FROM demos WHERE id=?", ("demo-fixture",))
        self.assertEqual(self.db.execute("SELECT id FROM demos").fetchall(), [("demo-fixture",)])
        self.db.execute("UPDATE subscription_journal SET state='published'")
        self.db.execute("DELETE FROM demos WHERE id=?", ("demo-fixture",))
        self.assertEqual(self.db.execute("SELECT id FROM moment_sets").fetchall(), [])

    def test_denial_metadata_keeps_complete_selection_and_disposition(self):
        members = ["operation-a", "operation-b", "operation-c"]
        uncharged = list(members)
        self.db.execute("INSERT INTO subscription_batch_denials VALUES(?,?,?)",
                        ("batch-fixture", json.dumps(members), json.dumps(uncharged)))
        self.db.commit()
        stored = self.db.execute("SELECT operation_ids_json,uncharged_ids_json FROM subscription_batch_denials WHERE batch_id=?",
                                 ("batch-fixture",)).fetchone()
        self.assertEqual(json.loads(stored[0]), members)
        self.assertEqual(json.loads(stored[1]), uncharged)
        # This is a schema round-trip only, not execution of Rust's transaction/recovery.

    def test_pending_group_name_cannot_be_taken_by_rename(self):
        self.pending({"object": "group", "name": "Reserved"})
        with self.assertRaisesRegex(sqlite3.IntegrityError, "subscription group name pending"):
            self.db.execute("UPDATE groups SET name=? WHERE id=?", ("Reserved", "group-fixture"))
        self.assertEqual(self.db.execute("SELECT name FROM groups").fetchall(), [("Existing",)])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--desktop-repo", type=Path, default=Path("D:/demo-manager"))
    args = parser.parse_args()
    SubscriptionMigrationTests.migration_dir = args.desktop_repo / "src-tauri/migrations/sqlite"
    print(f"In-memory migration checks using SQLite {sqlite3.sqlite_version}", flush=True)
    unittest.main(argv=[sys.argv[0]], verbosity=2)
