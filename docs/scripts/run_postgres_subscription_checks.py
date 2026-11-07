"""Disposable password-authenticated PostgreSQL checks; use the Windows limiter.

Pinned binary archive with SHA-512 verification; no npm lifecycle scripts.
Only the temporary loopback cluster is migrated. Every connection uses SCRAM.
The enclosing Windows Job Object contains the server and all descendants.
"""
import argparse
import base64
from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tarfile
import tempfile
import urllib.request

VERSION = "18.6.0-beta.19"
URL = f"https://registry.npmjs.org/@embedded-postgres/windows-x64/-/windows-x64-{VERSION}.tgz"
SHA512 = "fp8d8f+6WfJQftX0D+l1vUTLPwCN5hlhV/g/KI5zDBwHURmta6ph3/kJeEOVirtbczO/pKQlqM4cELB2c7Sp7Q=="
PORT = 55438
USER = "watchdemo_qa"
PASSWORD = "watchdemo_qa_local_only"
DATABASE = "watchdemo_prelaunch_qa"
ROOT = Path(__file__).resolve().parents[2]


@contextmanager
def runtime():
    # Never execute a mutable, predictable TEMP-cache installation. Hash the
    # exact in-memory archive we extract into a fresh private temporary folder.
    with urllib.request.urlopen(URL, timeout=60) as response:
        payload = response.read()
    if base64.b64encode(hashlib.sha512(payload).digest()).decode() != SHA512:
        raise RuntimeError("PostgreSQL runtime integrity mismatch; refusing to execute")
    with tempfile.TemporaryDirectory(prefix="watchdemo-pg-runtime-") as directory:
        extracted = Path(directory)
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as package:
            package.extractall(extracted, filter="data")
        del payload
        matches = list(extracted.rglob("postgres.exe"))
        if len(matches) != 1:
            raise RuntimeError(f"Expected one postgres.exe, found {len(matches)}")
        binaries = matches[0].parent
        subprocess.run([str(binaries / "postgres.exe"), "--version"], check=True)
        yield binaries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", required=True, help="Existing local test interpreter")
    parser.add_argument("--full-suite", action="store_true", help="Run every web test after migration checks in the same disposable cluster")
    args = parser.parse_args()
    if os.name != "nt":
        raise RuntimeError("This runner is specifically for contained Windows checks")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", PORT))
    env = {key: value for key, value in os.environ.items()
           if not key.upper().startswith("PG")
           and key.upper() not in {"TEST_DATABASE_URL", "QA_DISPOSABLE_ROOT", "QA_DISPOSABLE_TOKEN"}}
    env.update(PGPASSWORD=PASSWORD, PYTEST_DISABLE_PLUGIN_AUTOLOAD="1", PYTHONDONTWRITEBYTECODE="1", LC_ALL="C", LANGUAGE="en")
    with runtime() as binaries, tempfile.TemporaryDirectory(prefix="watchdemo-pg-qa-") as directory:
        root = Path(directory).resolve(strict=True)
        data = root / "data"
        password_file = root / "password.txt"
        password_file.write_text(PASSWORD, encoding="ascii")
        subprocess.run([str(binaries / "initdb.exe"), "-D", str(data), "-U", USER,
                        "--pwfile", str(password_file), "--auth-host=scram-sha-256",
                        "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"], env=env, check=True)
        password_file.unlink()
        log_path = root / "postgres.log"
        # pg_ctl uses PostgreSQL's standard restricted Windows process token;
        # direct postgres refuses an administrator token. No elevation or job breakaway.
        options = f"-h 127.0.0.1 -p {PORT} -c shared_buffers=32MB -c max_connections=12 -c work_mem=2MB -c maintenance_work_mem=16MB -c timezone=UTC"
        started = False
        try:
            subprocess.run([str(binaries / "pg_ctl.exe"), "-D", str(data), "-l", str(log_path),
                "-w", "-t", "25", "-o", options, "start"], env=env, check=True)
            started = True
            lines = (data / "postmaster.pid").read_text().splitlines()
            if len(lines) < 8 or int(lines[3]) != PORT or lines[7].strip() != "ready":
                raise RuntimeError("Temporary PostgreSQL port/readiness mismatch")
            # The server-only binary package need not contain the psql client.
            setup = f"""import asyncio, asyncpg
async def create():
    connection = await asyncpg.connect(host='127.0.0.1', port={PORT}, user='{USER}', password='{PASSWORD}', database='postgres', timeout=5)
    try:
        await connection.execute('CREATE DATABASE {DATABASE}')
    finally:
        await connection.close()
asyncio.run(create())
"""
            subprocess.run([args.python, "-B", "-c", setup], env=env, check=True)
            env["TEST_DATABASE_URL"] = f"postgresql+asyncpg://{USER}:{PASSWORD}@127.0.0.1:{PORT}/{DATABASE}"
            token = secrets.token_hex(32)
            proof = {"token": token, "database_url": env["TEST_DATABASE_URL"],
                     "data_directory": str(data)}
            with (root / "qa-disposable.json").open("x", encoding="utf-8") as marker:
                json.dump(proof, marker)
            env.update(QA_DISPOSABLE_ROOT=str(root), QA_DISPOSABLE_TOKEN=token)
            selectors = ["web/tests/test_migration_history.py", "web/tests/test_quota_service.py",
                         "web/tests/test_quota_identity_map.py", "web/tests/test_auth_logout.py",
                         "web/tests/test_auth_token_concurrency.py", "web/tests/test_release_publication.py"]
            if args.full_suite:
                selectors = [selectors[0], *[str(path.relative_to(ROOT))
                    for path in sorted((ROOT / "web/tests").glob("test_*.py"))
                    if path.name != "test_migration_history.py"]]
            result = subprocess.run([args.python, "-B", "-m", "pytest", "-p", "no:cacheprovider",
                *selectors, "-q", "-ra", "--tb=short"], cwd=ROOT, env=env)
            return result.returncode
        finally:
            if started or (data / "postmaster.pid").exists():
                subprocess.run([str(binaries / "pg_ctl.exe"), "-D", str(data),
                    "-m", "immediate", "-w", "-t", "15", "stop"], env=env, check=True)
            print("Disposable PostgreSQL stopped; temporary cluster removed on exit.", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
