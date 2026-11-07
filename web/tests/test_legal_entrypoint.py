"""Exercise the deployed Uvicorn flags over localhost, without service startup.

The application's lifespan is disabled: no database, Redis, broker, or email.
Only the host/port and lifespan flags differ from the compose entrypoint.
"""
import json
from pathlib import Path
import shlex
import socket
import subprocess
import sys
import time

import httpx
import pytest


WEB = Path(__file__).resolve().parents[1]
BOOTSTRAP = """
import json, runpy, sys
from pathlib import Path
sys.path.insert(0, str(Path('tests').resolve()))
runpy.run_path('tests/conftest.py')
from APP.config import settings
settings.app.trusted_proxy_addresses = json.loads(sys.argv[1])
from fastapi import Request
from main import app
from APP.rate_limiter import client_ip

@app.get('/__qa_client_ip')
def address(request: Request):
    return {'ip': client_ip(request)}

from uvicorn.main import main
main(args=sys.argv[2:], standalone_mode=False)
"""


@pytest.mark.parametrize("trusted,forwarded,expected", [
    ([], "192.0.2.66", "127.0.0.1"),
    (["127.0.0.1"], "203.0.113.5", "203.0.113.5"),
    (["127.0.0.1", "10.0.0.0/24"], "192.0.2.66, 203.0.113.5, 10.0.0.3", "203.0.113.5"),
])
def test_compose_entrypoint_preserves_application_proxy_trust(trusted, forwarded, expected):
    compose = (WEB.parent / "docker-compose.yml").read_text()
    command = next(line.strip().removeprefix("command: ") for line in compose.splitlines()
                   if "command:" in line and "uvicorn main:app" in line)
    args = shlex.split(command)
    assert args[:4] == ["poetry", "run", "uvicorn", "main:app"]
    args = args[3:]
    assert "--no-proxy-headers" in args
    assert "--proxy-headers" not in args
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    args[args.index("--host") + 1] = "127.0.0.1"
    args[args.index("--port") + 1] = str(port)
    args += ["--lifespan", "off"]
    process = subprocess.Popen([sys.executable, "-c", BOOTSTRAP, json.dumps(trusted), *args],
                               cwd=WEB, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 15
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=1) as client:
            while True:
                assert process.poll() is None, "QA entrypoint exited before the request: " + process.stderr.read().decode(errors="replace")
                try:
                    response = client.get("/__qa_client_ip", headers={
                        "X-Forwarded-For": forwarded,
                        "Forwarded": 'for="192.0.2.77"',
                        "X-Real-IP": "192.0.2.88",
                    })
                    break
                except (httpx.ConnectError, httpx.ConnectTimeout):
                    if time.monotonic() >= deadline:
                        raise AssertionError("Local QA entrypoint did not start") from None
                    time.sleep(0.05)
            assert response.status_code == 200
            assert response.json() == {"ip": expected}
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        process.stderr.close()
