import asyncio
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("RABBITMQ__HOST", "localhost")
os.environ.setdefault("RABBITMQ__USER", "test")
os.environ.setdefault("RABBITMQ__PASSWORD", "test")
os.environ.setdefault("RESEND__API", "re_test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from aio_pika import IncomingMessage  # noqa: E402

import consumer  # noqa: E402


class FakeMessage:
    """What aio_pika's real ProcessContext touches on a message."""

    process = IncomingMessage.process

    def __init__(self, payload):
        self.body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.processed = False
        self.redelivered = False
        self.channel = type("Ch", (), {"is_closed": False})()
        self.outcome = None

    async def ack(self):
        self.processed, self.outcome = True, "ack"

    async def reject(self, requeue=False):
        self.processed, self.outcome = True, ("reject", requeue)


def _msg(data):
    return {"type": "verify_email", "to_email": "a@watchdemo.pro", "to_name": "a", "data": data}


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
