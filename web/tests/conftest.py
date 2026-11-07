"""Collection-time test settings: never read the shared/root dotenv secrets."""

import os
import sys
from pathlib import Path
from unittest.mock import patch

# Validate opt-in before importing any application/driver/settings code.
from qa_safety import require_disposable_database

if os.environ.get("TEST_DATABASE_URL"):
    require_disposable_database(os.environ["TEST_DATABASE_URL"])

from pydantic_settings import DotEnvSettingsSource

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Explicit local/fake values, not setdefault (the shell may contain real secrets).
# TEST_DATABASE_URL remains an explicit opt-in for disposable integration tests.
for key in list(os.environ):
    if key.upper().split("__", 1)[0] in {
        "POSTGRES", "JWT", "RABBITMQ", "RESEND", "APP", "REDIS", "INTERNAL_API_TOKEN",
        "RELEASES", "SYMBOLS", "SUPPORT", "ENTITLEMENT",
    }:
        del os.environ[key]
os.environ.update({
    "POSTGRES__HOST": "127.0.0.1",
    "POSTGRES__PORT": "55438",
    "POSTGRES__USER": "watchdemo_qa",
    "POSTGRES__PASSWORD": "watchdemo_qa_local_only",
    "POSTGRES__DATABASE": "watchdemo_prelaunch_qa",
    "JWT__SECRET": "test-secret-test-secret-test-secret",
    "RABBITMQ__HOST": "127.0.0.1",
    "RABBITMQ__USER": "test",
    "RABBITMQ__PASSWORD": "test",
    "RESEND__API": "re_test_never_send",
    "APP__FRONTEND_URL": "https://frontend.example.invalid",
    "REDIS__HOST": "127.0.0.1",
})

# Dotenv reads occur while constructing the source, before __call__; block the
# file read itself only during the one settings import. Production is unchanged.
with patch.object(DotEnvSettingsSource, "_read_env_files", return_value={}):
    from APP.config import settings  # noqa: F401, E402
