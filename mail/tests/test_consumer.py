import asyncio
import json
from datetime import datetime, timedelta, timezone
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from aio_pika import IncomingMessage  # noqa: E402

import consumer  # noqa: E402


class FakeMessage:
    """What aio_pika's real ProcessContext touches on a message."""

    process = IncomingMessage.process

    def __init__(self, payload, headers=None):
        self.body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.headers = headers or {}
        self.processed = False
        self.redelivered = False
        self.channel = type("Ch", (), {"is_closed": False})()
        self.outcome = None

    async def ack(self):
        self.processed, self.outcome = True, "ack"

    async def reject(self, requeue=False):
        self.processed, self.outcome = True, ("reject", requeue)


def _msg(data):
    return {"type": "verify_email", "to_email": "qa@example.invalid", "to_name": "a", "data": data}


@pytest.mark.parametrize("payload", [_msg({}), b"not json", {"type": "verify_email"}])
def test_poison_message_is_rejected_without_requeue(payload):
    message = FakeMessage(payload)
    asyncio.run(consumer._handle_message(message))
    assert message.outcome == ("reject", False)


def test_send_failure_is_requeued(monkeypatch):
    async def boom(_):
        raise RuntimeError("resend down")

    monkeypatch.setattr(consumer, "send_email", boom)
    message = FakeMessage(_msg({"verification_url": "u", "expires_in_hours": 24}))
    with pytest.raises(RuntimeError):
        asyncio.run(consumer._handle_message(message))
    assert message.outcome == ("reject", True)


def test_good_message_is_acked(monkeypatch):
    sent = []

    async def ok(m):
        sent.append(m)

    monkeypatch.setattr(consumer, "send_email", ok)
    message = FakeMessage(_msg({"verification_url": "u", "expires_in_hours": 24}))
    asyncio.run(consumer._handle_message(message))
    assert message.outcome == "ack" and len(sent) == 1


NOW = datetime(2026, 11, 3, 12, tzinfo=timezone.utc)
NOTICE_ID = "8a2dcff6-1471-4e8b-bd3a-58873537a310"


def legal_payload(created_at=NOW):
    return {
        "type": "legal_revision_updated", "notification_id": NOTICE_ID,
        "created_at": created_at.isoformat(), "to_email": "qa@example.invalid",
        "to_name": "QA", "locale": "en",
        "data": {"document_title": "Условия", "document_revision": "v1",
                 "effective_date": "2026-11-03",
                 "document_url": "http://localhost:5173/en/legal/terms/v1"},
    }


class FakeExchange:
    def __init__(self, incoming, result=True, error=None):
        self.incoming = incoming
        self.result = result
        self.error = error
        self.publications = []

    async def publish(self, outgoing, routing_key, mandatory):
        # The incoming job must still be owned until a positive broker confirm.
        assert self.incoming.outcome is None
        self.publications.append((outgoing, routing_key, mandatory))
        if self.error:
            raise self.error
        return self.result


class FakeChannel:
    def __init__(self, incoming, **kwargs):
        self.default_exchange = FakeExchange(incoming, **kwargs)


def test_legal_success_acks_without_retry(monkeypatch):
    sent = []

    async def ok(message):
        sent.append(message)

    monkeypatch.setattr(consumer, "_now", lambda: NOW)
    monkeypatch.setattr(consumer, "send_email", ok)
    incoming = FakeMessage(legal_payload())
    channel = FakeChannel(incoming)
    asyncio.run(consumer._handle_message(incoming, channel))
    assert incoming.outcome == "ack"
    assert len(sent) == 1
    assert str(sent[0].notification_id) == NOTICE_ID
    assert not channel.default_exchange.publications


def test_legal_provider_failure_persists_retry_before_ack(monkeypatch, caplog):
    async def boom(_):
        raise RuntimeError("qa@example.invalid token=secret")

    monkeypatch.setattr(consumer, "_now", lambda: NOW)
    monkeypatch.setattr(consumer, "send_email", boom)
    incoming = FakeMessage(legal_payload(), {consumer.ATTEMPT_HEADER: 1, "trace": "stable"})
    channel = FakeChannel(incoming)
    asyncio.run(consumer._handle_message(incoming, channel))
    outgoing, routing_key, mandatory = channel.default_exchange.publications[0]
    assert incoming.outcome == "ack"
    assert routing_key == consumer.settings.rabbitmq.email_queue + ".legal.retry"
    assert mandatory is True
    assert outgoing.body == incoming.body  # Includes unchanged id and original created_at.
    assert outgoing.message_id == NOTICE_ID
    assert outgoing.headers[consumer.ATTEMPT_HEADER] == 2
    assert outgoing.headers[consumer.REASON_HEADER] == "provider_error"
    assert outgoing.headers["trace"] == "stable"
    assert outgoing.delivery_mode == 2
    assert "qa@example.invalid" not in caplog.text
    assert "token=secret" not in caplog.text


@pytest.mark.parametrize("age,attempts,reason", [
    (consumer.LEGAL_MAX_AGE, 0, "expired_outcome_unknown"),
    (consumer.LEGAL_MAX_AGE + timedelta(seconds=1), 0, "expired_outcome_unknown"),
    (timedelta(0), consumer.LEGAL_MAX_ATTEMPTS, "attempts_exhausted"),
    (timedelta(seconds=-1), 0, "future_created_at"),
])
def test_legal_expired_or_exhausted_is_failed_without_provider_call(monkeypatch, age, attempts, reason):
    async def never(_):
        pytest.fail("provider must not be called")

    monkeypatch.setattr(consumer, "_now", lambda: NOW)
    monkeypatch.setattr(consumer, "send_email", never)
    incoming = FakeMessage(legal_payload(NOW - age), {consumer.ATTEMPT_HEADER: attempts})
    channel = FakeChannel(incoming)
    asyncio.run(consumer._handle_message(incoming, channel))
    outgoing, route, _ = channel.default_exchange.publications[0]
    assert route.endswith(".legal.failed")
    assert outgoing.headers[consumer.REASON_HEADER] == reason
    assert outgoing.body == incoming.body
    assert incoming.outcome == "ack"


@pytest.mark.parametrize("expire_during_send", [False, True])
def test_legal_last_failure_goes_to_failed_queue(monkeypatch, expire_during_send):
    async def boom(_):
        if expire_during_send:
            monkeypatch.setattr(consumer, "_now", lambda: NOW + consumer.LEGAL_MAX_AGE)
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(consumer, "_now", lambda: NOW)
    monkeypatch.setattr(consumer, "send_email", boom)
    attempts = 0 if expire_during_send else consumer.LEGAL_MAX_ATTEMPTS - 1
    incoming = FakeMessage(legal_payload(), {consumer.ATTEMPT_HEADER: attempts})
    channel = FakeChannel(incoming)
    asyncio.run(consumer._handle_message(incoming, channel))
    outgoing, route, _ = channel.default_exchange.publications[0]
    assert route.endswith(".legal.failed")
    assert outgoing.headers[consumer.ATTEMPT_HEADER] == attempts + 1
    expected = "expired_outcome_unknown" if expire_during_send else "attempts_exhausted"
    assert outgoing.headers[consumer.REASON_HEADER] == expected
    assert incoming.outcome == "ack"


@pytest.mark.parametrize("attempts", [-1, "2", True])
def test_legal_invalid_attempt_headers_are_durably_failed(monkeypatch, attempts):
    monkeypatch.setattr(consumer, "_now", lambda: NOW)
    incoming = FakeMessage(legal_payload(), {consumer.ATTEMPT_HEADER: attempts})
    channel = FakeChannel(incoming)
    asyncio.run(consumer._handle_message(incoming, channel))
    outgoing, route, _ = channel.default_exchange.publications[0]
    assert route.endswith(".legal.failed")
    assert outgoing.headers[consumer.REASON_HEADER] == "malformed"
    assert incoming.outcome == "ack"


def test_malformed_legal_payload_is_durably_failed(monkeypatch):
    monkeypatch.setattr(consumer, "_now", lambda: NOW)
    payload = legal_payload()
    del payload["created_at"]
    incoming = FakeMessage(payload)
    channel = FakeChannel(incoming)
    asyncio.run(consumer._handle_message(incoming, channel))
    outgoing, route, _ = channel.default_exchange.publications[0]
    assert route.endswith(".legal.failed")
    assert outgoing.body == incoming.body
    assert outgoing.headers[consumer.REASON_HEADER] == "malformed"
    assert incoming.outcome == "ack"


@pytest.mark.parametrize("failure", ["error", "unconfirmed"])
@pytest.mark.parametrize("expired", [False, True])
def test_storage_publish_failure_never_acks_original(monkeypatch, failure, expired):
    async def boom(_):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(consumer, "_now", lambda: NOW)
    monkeypatch.setattr(consumer, "send_email", boom)
    created_at = NOW - consumer.LEGAL_MAX_AGE if expired else NOW
    incoming = FakeMessage(legal_payload(created_at))
    channel = FakeChannel(incoming, error=RuntimeError("broker unavailable") if failure == "error" else None,
                          result=False if failure == "unconfirmed" else True)
    with pytest.raises(RuntimeError):
        asyncio.run(consumer._handle_message(incoming, channel))
    assert incoming.outcome == ("reject", True)


def test_queue_declarations_preserve_existing_queue_arguments():
    declarations = []
    sentinel = object()

    class Channel:
        async def declare_queue(self, name, **kwargs):
            declarations.append((name, kwargs))
            return sentinel

    assert asyncio.run(consumer._declare_queues(Channel())) is sentinel
    queue_name = consumer.settings.rabbitmq.email_queue
    assert declarations[0] == (queue_name, {"durable": True})
    assert declarations[1] == (queue_name + ".legal.retry", {"durable": True, "arguments": {
        "x-message-ttl": consumer.LEGAL_RETRY_DELAY_MS,
        "x-queue-type": "quorum", "x-dead-letter-strategy": "at-least-once",
        "x-overflow": "reject-publish", "x-dead-letter-exchange": "",
        "x-dead-letter-routing-key": queue_name,
    }})
    assert declarations[2] == (queue_name + ".legal.failed", {"durable": True})


def test_complete_retry_chain_is_bounded_and_keeps_original_identity(monkeypatch):
    calls = []

    async def boom(message):
        calls.append(message)
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(consumer, "_now", lambda: NOW)
    monkeypatch.setattr(consumer, "send_email", boom)
    incoming = FakeMessage(legal_payload())
    original_body = incoming.body
    for attempt in range(1, consumer.LEGAL_MAX_ATTEMPTS + 1):
        channel = FakeChannel(incoming)
        asyncio.run(consumer._handle_message(incoming, channel))
        outgoing, route, _ = channel.default_exchange.publications[0]
        assert outgoing.body == original_body
        assert outgoing.message_id == NOTICE_ID
        assert outgoing.headers[consumer.ATTEMPT_HEADER] == attempt
        assert incoming.outcome == "ack"
        assert route.endswith(".legal.failed" if attempt == consumer.LEGAL_MAX_ATTEMPTS else ".legal.retry")
        incoming = FakeMessage(outgoing.body, outgoing.headers)
    assert len(calls) == consumer.LEGAL_MAX_ATTEMPTS
    assert all(str(message.notification_id) == NOTICE_ID for message in calls)


def test_invalid_payload_or_provider_value_error_is_terminal(monkeypatch):
    async def invalid(_):
        raise ValueError("unusable payload")

    monkeypatch.setattr(consumer, "_now", lambda: NOW)
    monkeypatch.setattr(consumer, "send_email", invalid)
    incoming = FakeMessage(legal_payload())
    channel = FakeChannel(incoming)
    asyncio.run(consumer._handle_message(incoming, channel))
    outgoing, route, _ = channel.default_exchange.publications[0]
    assert route.endswith(".legal.failed")
    assert outgoing.headers[consumer.REASON_HEADER] == "invalid_payload_or_provider_rejection"
    assert outgoing.headers[consumer.ATTEMPT_HEADER] == 1
    assert incoming.outcome == "ack"
