"""Stdlib-only negative gate: run directly, without pytest/application imports."""
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

from qa_safety import DATABASE_URL, require_disposable_database


class DisposableDatabaseSafetyTests(unittest.TestCase):
    def test_rejection_never_connects(self):
        vectors = [None, "", DATABASE_URL, DATABASE_URL + "?host=example.com",
                   DATABASE_URL.replace("127.0.0.1", "127.example.com"),
                   DATABASE_URL.replace("55438", "5432"),
                   DATABASE_URL.replace("watchdemo_prelaunch_qa", "production")]
        with patch.dict(os.environ, {}, clear=True), patch.object(socket, "create_connection") as connect:
            for url in vectors:
                with self.subTest(url=url), self.assertRaises((ValueError, OSError)):
                    require_disposable_database(url)
                    socket.create_connection(("127.0.0.1", 55438))
            connect.assert_not_called()

    def test_exact_owned_cluster_proof_and_tampered_identity(self):
        with tempfile.TemporaryDirectory(prefix="watchdemo-pg-qa-") as directory:
            root = Path(directory).resolve()
            data = root / "data"
            data.mkdir()
            token = "a" * 64
            marker = {"token": token, "database_url": DATABASE_URL, "data_directory": str(data)}
            marker_path = root / "qa-disposable.json"
            marker_path.write_text(json.dumps(marker), encoding="utf-8")
            pid = data / "postmaster.pid"
            lines = ["12345", str(data), "0", "55438", "", "127.0.0.1", "0", "ready"]
            pid.write_text("\n".join(lines), encoding="utf-8")
            with patch.dict(os.environ, {"QA_DISPOSABLE_TOKEN": token,
                                         "QA_DISPOSABLE_ROOT": str(root)}, clear=True), \
                    patch.object(socket, "create_connection") as connect:
                require_disposable_database(DATABASE_URL)
                for index, value in [(1, str(root)), (3, "5432"), (5, "0.0.0.0"), (7, "starting")]:
                    altered = lines.copy()
                    altered[index] = value
                    pid.write_text("\n".join(altered), encoding="utf-8")
                    with self.subTest(index=index), self.assertRaises(ValueError):
                        require_disposable_database(DATABASE_URL)
                pid.write_text("\n".join(lines), encoding="utf-8")
                marker["token"] = "b" * 64
                marker_path.write_text(json.dumps(marker), encoding="utf-8")
                with self.assertRaises(ValueError):
                    require_disposable_database(DATABASE_URL)
                connect.assert_not_called()

    def test_wrong_or_incomplete_cluster_proof_never_connects(self):
        with tempfile.TemporaryDirectory(prefix="watchdemo-pg-qa-") as directory:
            root = Path(directory)
            for marker in [None, '{}']:
                if marker is not None:
                    (root / "qa-disposable.json").write_text(marker)
                with patch.dict(os.environ, {"QA_DISPOSABLE_TOKEN": "a" * 64,
                                             "QA_DISPOSABLE_ROOT": directory}, clear=True), \
                        patch.object(socket, "create_connection") as connect:
                    with self.assertRaises((ValueError, OSError)):
                        require_disposable_database(DATABASE_URL)
                        socket.create_connection(("127.0.0.1", 55438))
                    connect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
