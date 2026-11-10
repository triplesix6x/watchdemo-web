"""Run Windows bot/mail tests with only owned loopback TestServer connections.

The existing unreachable-port fixture receives a simulated connection refusal.
This runner is independent of the current directory, not a hostile-code sandbox.
"""

from contextvars import ContextVar
from pathlib import Path
import os, socket, sys
from asyncio.windows_events import IocpProactor
from unittest.mock import patch
from pydantic_settings import DotEnvSettingsSource
import pytest

service = sys.argv[1]
if service not in ("bot", "mail"):
    raise ValueError(service)
root = Path(__file__).resolve().parents[2] / service
sys.path.insert(0, str(root))
sys.dont_write_bytecode = True
prefixes = {
    "TELEGRAM",
    "TELEGRAM_BOT_TOKEN",
    "INTERNAL_API_TOKEN",
    "RABBITMQ",
    "RESEND",
    "APP",
    "POSTGRES",
    "JWT",
    "REDIS",
    "SUPPORT",
}
for key in list(os.environ):
    if key.upper().split("__", 1)[0] in prefixes:
        del os.environ[key]
os.environ.update(
    TELEGRAM_BOT_TOKEN="123456:TEST",
    INTERNAL_API_TOKEN="internal-test",
    RABBITMQ__HOST="127.0.0.1",
    RABBITMQ__USER="test",
    RABBITMQ__PASSWORD="test",
    RESEND__API="re_test_never_send",
    APP__FRONTEND_URL=(
        "https://watchdemo.pro"
        if service == "bot"
        else "https://frontend.example.invalid"
    ),
    PYTEST_DISABLE_PLUGIN_AUTOLOAD="1",
)
inside = ContextVar("stdlib_socketpair", default=False)
original = {
    name: getattr(socket.socket, name)
    for name in ("bind", "listen", "connect", "connect_ex", "close")
}
old_pair = socket.socketpair
old_dns = socket.getaddrinfo
old_proactor_connect = IocpProactor.connect
listeners = {}
connected = 0
refused = 0


def bind(sock, address):
    if not inside.get() and not (
        isinstance(address, tuple) and address[:2] == ("127.0.0.1", 0)
    ):
        raise RuntimeError("Only owned ephemeral loopback test listeners are allowed")
    return original["bind"](sock, address)


def listen(sock, *args):
    result = original["listen"](sock, *args)
    if not inside.get():
        listeners[id(sock)] = sock.getsockname()[:2]
    return result


def close(sock):
    listeners.pop(id(sock), None)
    return original["close"](sock)


def allowed(address):
    global refused
    if address == ("127.0.0.1", 9):
        refused += 1
        raise ConnectionRefusedError(
            10061, "QA unreachable fixture: actual port 9 connection forbidden"
        )
    if not inside.get() and not (
        isinstance(address, tuple) and address[:2] in listeners.values()
    ):
        raise RuntimeError("Unowned network connection forbidden: " + repr(address))


def connect(sock, address):
    global connected
    allowed(address)
    connected += not inside.get()
    return original["connect"](sock, address)


def connect_ex(sock, address):
    global connected
    allowed(address)
    connected += not inside.get()
    return original["connect_ex"](sock, address)


def proactor_connect(proactor, conn, address):
    global connected
    allowed(address)
    connected += not inside.get()
    return old_proactor_connect(proactor, conn, address)


def pair(*args, **kwargs):
    token = inside.set(True)
    try:
        return old_pair(*args, **kwargs)
    finally:
        inside.reset(token)


def dns(host, port, *args, **kwargs):
    if inside.get():
        return old_dns(host, port, *args, **kwargs)
    if host != "127.0.0.1" or not (port == 0 or (host, port) in listeners.values()):
        raise RuntimeError("DNS/external target forbidden: " + repr((host, port)))
    return old_dns(host, port, *args, **kwargs)


with patch.object(
    DotEnvSettingsSource, "_read_env_files", return_value={}
), patch.object(socket.socket, "bind", bind), patch.object(
    socket.socket, "listen", listen
), patch.object(
    socket.socket, "close", close
), patch.object(
    socket.socket, "connect", connect
), patch.object(
    socket.socket, "connect_ex", connect_ex
), patch.object(
    socket, "socketpair", pair
), patch.object(
    socket, "getaddrinfo", dns
), patch.object(
    IocpProactor, "connect", proactor_connect
):
    code = pytest.main(["-q", "-p", "no:cacheprovider", str(root / "tests")])
    print(
        "OWNED_LOOPBACK_CONNECTIONS",
        connected,
        "SIMULATED_REFUSALS",
        refused,
        "REMAINING_LISTENERS",
        len(listeners),
    )
    raise SystemExit(code)
