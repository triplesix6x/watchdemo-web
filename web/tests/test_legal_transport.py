"""Trust-boundary and readiness transport tests: no real network or brokers."""

import asyncio
import json
import traceback
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi import FastAPI, Request
from pydantic import ValidationError
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from APP.config import AppConfig, settings
from APP.constants import EmailMessageType, Locale
from APP.services import auth_service
from APP.rate_limiter import client_ip
from APP.services import legal_service as svc
from SPI.mq_adapter import publisher as mq


def test_proxy_config_is_default_deny_and_never_accepts_wildcard_or_hostname():
    assert AppConfig(frontend_url="https://frontend.example.invalid").trusted_proxy_addresses == []
    for value in ("*", "proxy.example.invalid", "0.0.0.0/0-not-a-cidr"):
        with pytest.raises(ValidationError):
            AppConfig(frontend_url="https://frontend.example.invalid", trusted_proxy_addresses=[value])
    assert AppConfig(frontend_url="https://frontend.example.invalid",
                     trusted_proxy_addresses=["127.0.0.1", "10.0.0.0/24", "::1"]).trusted_proxy_addresses


@pytest.mark.parametrize("trusted,peer,forwarded,expected", [
    ([], "198.51.100.20", "203.0.113.5", "198.51.100.20"),
    (["127.0.0.1"], "198.51.100.20", "203.0.113.5", "198.51.100.20"),
    (["127.0.0.1"], "127.0.0.1", "203.0.113.5", "203.0.113.5"),
    (["10.0.0.0/24"], "10.0.0.2", "192.0.2.99, 203.0.113.5, 10.0.0.3", "203.0.113.5"),
])
def test_proxy_headers_only_authoritative_from_configured_peer(trusted, peer, forwarded, expected):
    app = FastAPI()
    app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=trusted)

    @app.get("/")
    def address(request: Request):
        return {"ip": client_ip(request)}

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=(peer, 1234)),
                                     base_url="http://test") as client:
            response = await client.get("/", headers={"X-Forwarded-For": forwarded,
                                                      "Forwarded": 'for="192.0.2.66"', "X-Real-IP": "192.0.2.77"})
            assert response.json() == {"ip": expected}
    asyncio.run(run())


def test_main_installs_only_configured_proxy_trust():
    from main import app

    middleware = next(m for m in app.user_middleware if m.cls is ProxyHeadersMiddleware)
    assert middleware.kwargs["trusted_hosts"] == settings.app.trusted_proxy_addresses == []


def test_manifest_fetch_uses_only_configured_origin_size_and_timeout(monkeypatch):
    manifest = {"schema_version": 1}
    requests = []

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, size):
            assert size == svc.MAX_MANIFEST_BYTES + 1
            return json.dumps(manifest).encode()

    class Opener:
        def open(self, request, *, timeout):
            requests.append(request.full_url)
            assert timeout == settings.app.legal_manifest_timeout_seconds
            return Response()

    def build(*handlers):
        assert any(isinstance(handler, svc.ProxyHandler) and handler.proxies == {} for handler in handlers)
        assert any(isinstance(handler, svc._NoRedirect) for handler in handlers)
        return Opener()

    monkeypatch.setattr(svc, "build_opener", build)
    assert asyncio.run(svc.fetch_publication_manifest()) == manifest
    assert requests == ["https://frontend.example.invalid/legal/catalog-manifest.json"]
    # Even same-origin redirects are refused; cross-origin never followed.
    assert svc._NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://evil.invalid") is None


@pytest.mark.parametrize("body,status", [(b"x" * (svc.MAX_MANIFEST_BYTES + 1), 200), (b"{}", 503), (b"not-json", 200)],
                         ids=["oversize-body", "bad-status", "invalid-json"])
def test_manifest_rejects_oversize_bad_status_and_invalid_json(monkeypatch, body, status):
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, size):
            return body

    response = Response()
    response.status = status
    monkeypatch.setattr(svc, "build_opener", lambda *args: SimpleNamespace(open=lambda *a, **k: response))
    with pytest.raises(ValueError):
        asyncio.run(svc.fetch_publication_manifest())


@pytest.mark.parametrize("origin", ["https://front.invalid/path", "https://u:p@front.invalid", "https://front.invalid?x=1", "file:///tmp/a"])
def test_manifest_origin_cannot_escape_configured_origin(monkeypatch, origin):
    monkeypatch.setattr(settings.app, "frontend_url", origin)
    with pytest.raises(svc.LegalPolicyUnavailable):
        svc.frontend_origin()


@pytest.mark.parametrize("required", [False, True])
def test_auth_email_failure_logs_and_public_traceback_exclude_address_and_token(monkeypatch, required):
    secret_address, secret_token = "private@example.com", "secret-token-do-not-log"
    logger = Mock()
    monkeypatch.setattr(auth_service, "logger", logger)
    service = auth_service.AuthService.__new__(auth_service.AuthService)
    service._publisher = SimpleNamespace(publish_email=AsyncMock(
        side_effect=RuntimeError(f"broker payload {secret_address} https://front.invalid/?token={secret_token}")))
    user = SimpleNamespace(id=uuid.uuid4(), email=secret_address, username="QA", locale=Locale.RU)

    async def run():
        operation = service._send_email(EmailMessageType.VERIFY_EMAIL, user,
                                        {"verification_url": f"https://front.invalid/?token={secret_token}"},
                                        required=required)
        if required:
            with pytest.raises(RuntimeError, match="^Email publication failed$") as caught:
                await operation
            rendered = "".join(traceback.format_exception(caught.value))
            assert secret_address not in rendered and secret_token not in rendered
        else:
            await operation
        logger.error.assert_called_once()
        logged = str(logger.mock_calls)
        assert secret_address not in logged and secret_token not in logged
        assert "error_type=%s" in logged and "RuntimeError" in logged
    asyncio.run(run())


def test_mq_email_success_logs_only_message_type_not_recipient(monkeypatch):
    from SPI.mq_adapter.schemas import EmailMessage

    logger = Mock()
    monkeypatch.setattr(mq, "logger", logger)
    publisher = mq.MQPublisher()
    publisher._publish = AsyncMock()
    message = EmailMessage(type=EmailMessageType.VERIFY_EMAIL, to_email="private@example.com",
                           to_name="QA", locale=Locale.RU, data={"verification_url": "secret-token"})
    asyncio.run(publisher.publish_email(message))
    logger.info.assert_called_once_with("[mq] published email message type=%s", message.type)
    assert "private@example.com" not in str(logger.mock_calls)
    assert "secret-token" not in str(logger.mock_calls)


def test_mq_uses_broker_confirm_mandatory_persistence_and_propagates_failure(monkeypatch):
    exchange = SimpleNamespace(publish=AsyncMock())
    channel = SimpleNamespace(default_exchange=exchange, declare_queue=AsyncMock())
    connection = SimpleNamespace(channel=AsyncMock(return_value=channel))
    connect = AsyncMock(return_value=connection)
    monkeypatch.setattr(mq.aio_pika, "connect_robust", connect)

    async def run():
        publisher = mq.MQPublisher()
        await publisher.connect()
        connection.channel.assert_awaited_once_with(publisher_confirms=True, on_return_raises=True)
        await publisher._publish("email", b"{}")
        args = exchange.publish.await_args
        assert args.kwargs == {"routing_key": "email", "mandatory": True}
        assert args.args[0].delivery_mode == mq.DeliveryMode.PERSISTENT
        exchange.publish.side_effect = RuntimeError("fake NACK")
        with pytest.raises(RuntimeError, match="fake NACK"):
            await publisher._publish("email", b"{}")
    asyncio.run(run())
