import asyncio
import json

import pytest
from aio_pika import IncomingMessage

import consumer
from conftest import BLOCKED, FakeTelegram, FakeWeb, fake_bot, limited

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
MID = "0192f3a4-0000-7000-8000-000000000001"


class FakeJob:
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


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    slept = []

    async def sleep(s):
        slept.append(s)

    monkeypatch.setattr(consumer.asyncio, "sleep", sleep)
    monkeypatch.setattr(consumer, "_unreported", {})
    return slept


def run(tg, web, *payloads):
    bot = fake_bot(tg)
    jobs = [FakeJob(p) for p in payloads]

    async def go():
        for job in jobs:
            try:
                await consumer.handle_job(bot, web, job)
            except Exception:
                pass

    asyncio.run(go())
    return [j.outcome for j in jobs]


def sends(tg):
    return [(name, p.get("text") or p.get("caption"), p["chat_id"]) for name, p in tg.calls]


def test_text_reply_is_sent_and_reported():
    tg, web = FakeTelegram(), FakeWeb(outbox={MID: {"chat_id": 4242, "body": "try F8", "has_image": False}})
    assert run(tg, web, {"message_id": MID}) == ["ack"]
    assert sends(tg) == [("sendMessage", "try F8", 4242)]
    assert web.calls[-1] == ("report", MID, {"sent": True, "tg_message_id": 900})


def test_image_reply_goes_as_photo_with_caption_long_text_separately():
    long = "x" * 1025
    items = {MID: {"chat_id": 4242, "body": "see screenshot", "has_image": True}, "m2": {"chat_id": 4242, "body": long, "has_image": True}}
    tg, web = FakeTelegram(), FakeWeb(outbox=items, image=PNG)
    run(tg, web, {"message_id": MID}, {"message_id": "m2"})
    assert sends(tg) == [("sendPhoto", "see screenshot", 4242), ("sendPhoto", None, 4242), ("sendMessage", long, 4242)]


def test_blocked_user_is_reported_failed_and_blocked():
    tg = FakeTelegram(script={"sendMessage": [BLOCKED]})
    web = FakeWeb(outbox={MID: {"chat_id": 4242, "body": "hello?", "has_image": False}})
    assert run(tg, web, {"message_id": MID}) == ["ack"]
    assert web.calls[-1] == ("report", MID, {"sent": False, "error": "Forbidden: bot was blocked by the user", "blocked": True})


def test_429_waits_retry_after_and_retries_once(no_waiting):
    tg = FakeTelegram(script={"sendMessage": [limited(3)]})
    web = FakeWeb(outbox={MID: {"chat_id": 4242, "body": "hi", "has_image": False}})
    run(tg, web, {"message_id": MID})
    assert [c[0] for c in tg.calls] == ["sendMessage", "sendMessage"] and no_waiting == [3]
    assert web.calls[-1] == ("report", MID, {"sent": True, "tg_message_id": 900})


def test_429_twice_fails_without_a_third_try(no_waiting):
    tg = FakeTelegram(script={"sendMessage": [limited(99), limited(99)]})
    web = FakeWeb(outbox={MID: {"chat_id": 4242, "body": "hi", "has_image": False}})
    run(tg, web, {"message_id": MID})
    assert len(tg.calls) == 2 and no_waiting == [30]
    assert web.calls[-1] == ("report", MID, {"sent": False, "error": "Too Many Requests: retry after 99", "blocked": False})


def test_redelivered_job_is_not_sent_twice():
    tg, web = FakeTelegram(), FakeWeb(outbox={MID: {"chat_id": 4242, "body": "once", "has_image": False}})
    assert run(tg, web, {"message_id": MID}, {"message_id": MID}) == ["ack", "ack"]
    assert sends(tg) == [("sendMessage", "once", 4242)]


def test_failed_report_requeues_and_the_retry_only_reports(no_waiting):
    tg = FakeTelegram()
    web = FakeWeb(outbox={MID: {"chat_id": 4242, "body": "once", "has_image": False}}, report_errors=1)
    assert run(tg, web, {"message_id": MID}, {"message_id": MID}) == [("reject", True), "ack"]
    assert sends(tg) == [("sendMessage", "once", 4242)]
    assert [c[0] for c in web.calls] == ["outbox", "report", "report"]
    assert no_waiting == [consumer.REQUEUE_DELAY]


@pytest.mark.parametrize("payload", [b"not json", {"id": MID}, [1]])
def test_malformed_job_is_dropped(payload):
    tg, web = FakeTelegram(), FakeWeb()
    assert run(tg, web, payload) == [("reject", False)]
    assert tg.calls == [] and web.calls == []
