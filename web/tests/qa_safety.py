"""Offline authorization for the disposable PostgreSQL test harness only."""
import json
import os
from pathlib import Path
import tempfile

DATABASE_URL = "postgresql+asyncpg://watchdemo_qa:watchdemo_qa_local_only@127.0.0.1:55438/watchdemo_prelaunch_qa"


def require_disposable_database(url: str | None) -> None:
    """Reject before driver creation; a database name alone is not authorization.

    The parent owns this fresh temp cluster and passes a random per-run capability.
    This protects against accidental targets, not a malicious same-user process.
    """
    if url != DATABASE_URL:
        raise ValueError("QA database target is not the disposable harness target")
    token = os.environ.get("QA_DISPOSABLE_TOKEN", "")
    if len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
        raise ValueError("Missing disposable cluster capability")
    root = Path(os.environ.get("QA_DISPOSABLE_ROOT", ""))
    temp = Path(tempfile.gettempdir()).resolve()
    if not root.is_absolute() or root.is_symlink():
        raise ValueError("Disposable cluster root must be an owned temporary directory")
    root = root.resolve(strict=True)
    if root.parent != temp or not root.name.startswith("watchdemo-pg-qa-"):
        raise ValueError("Disposable cluster root is outside the harness temp directory")
    marker_path = root / "qa-disposable.json"
    data = root / "data"
    if (marker_path.is_symlink() or data.is_symlink()
            or data.resolve(strict=True) != data):
        raise ValueError("Disposable proof must not use symlinks or junctions")
    marker = json.loads(marker_path.read_text(encoding="utf-8"))
    if marker != {"token": token, "database_url": DATABASE_URL, "data_directory": str(data)}:
        raise ValueError("Disposable cluster proof mismatch")
    pid_path = data / "postmaster.pid"
    if pid_path.is_symlink():
        raise ValueError("Disposable PID proof must not use symlinks")
    lines = pid_path.read_text(encoding="utf-8").splitlines()
    if (len(lines) < 8 or not lines[0].isdigit() or int(lines[0]) <= 0
            or Path(lines[1]).resolve() != data or lines[3] != "55438"
            or lines[5] != "127.0.0.1" or lines[7].strip() != "ready"):
        raise ValueError("Disposable PostgreSQL identity/readiness mismatch")
