"""Run pure subscription checks with fake settings and no network connections.

Invoke through run_limited_check_windows.py. Does not run PostgreSQL tests,
install dependencies, read production dotenv files, or create infrastructure.
"""
from contextvars import ContextVar
from pathlib import Path
import argparse
import importlib
import runpy
import socket
import sys
import unittest
from unittest.mock import patch


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cold-import-check", action="store_true", help="Import the quota service before API in a fresh, network-denied process")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    tests = root / "web" / "tests"
    sys.path.insert(0, str(tests))
    sys.dont_write_bytecode = True
    original_connect = socket.socket.connect
    original_socketpair = socket.socketpair
    in_socketpair = ContextVar("subscription_check_socketpair", default=False)

    def connect(sock, address):
        # Windows implements socketpair using a synchronous localhost handshake.
        # Only that standard-library call may connect; test/application code may not.
        if not in_socketpair.get():
            raise RuntimeError("Network forbidden in pure subscription checks")
        return original_connect(sock, address)

    def socketpair(*pair_args, **pair_kwargs):
        token = in_socketpair.set(True)
        try:
            return original_socketpair(*pair_args, **pair_kwargs)
        finally:
            in_socketpair.reset(token)

    def denied(*_args, **_kwargs):
        raise RuntimeError("Network forbidden in pure subscription checks")

    with patch.object(socket.socket, "connect", connect), patch.object(socket.socket, "connect_ex", denied), patch.object(socket, "socketpair", socketpair):
        # Bootstrap the existing fixture before importing any app modules.
        runpy.run_path(str(tests / "conftest.py"))
        if args.cold_import_check:
            importlib.import_module("APP.services.quota_service")
            importlib.import_module("API")
            print("PASS cold quota-service-first/API import without circular initialization")
            return 0
        # Signing and PostgreSQL suites use pytest and are separate gates.
        modules = ["test_quota_periods", "test_quota_protocol", "test_subscription_expiry"]
        suite = unittest.defaultTestLoader.loadTestsFromNames(modules)
        return int(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())


if __name__ == "__main__":
    raise SystemExit(main())
