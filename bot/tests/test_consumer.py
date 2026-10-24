import asyncio
import json

import pytest
from aio_pika import IncomingMessage

import consumer
from conftest import BLOCKED, FakeTelegram, FakeWeb, fake_bot, limited
from web_client import DeliveryReport, OutboxItem, WebError, WebUnavailable

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
MID = "0192f3a4-0000-7000-8000-000000000001"
MID2 = "0192f3a4-0000-7000-8000-000000000002"


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
    monkeypatch.setattr(consumer, "_attempts", {})
    return slept


def item(body, image_mime=None):
    return OutboxItem(chat_id=4242, body=body, image_mime=image_mime)


def run(tg, web, *payloads):
    bot = fake_bot(tg)
    jobs = [FakeJob(p) for p in payloads]

    async def go():
        for job in jobs:
            await consumer.handle_job(bot, web, job)

    asyncio.run(go())
    return [j.outcome for j in jobs]


def sends(tg):
    return [(name, p.get("text") or p.get("caption"), p["chat_id"]) for name, p in tg.calls]


def test_text_reply_is_sent_and_reported():
    tg, web = FakeTelegram(), FakeWeb(outbox={MID: item("try F8")})
    assert run(tg, web, {"message_id": MID}) == ["ack"]
    assert sends(tg) == [("sendMessage", "try F8", 4242)]
    assert web.calls[-1] == ("report", MID, DeliveryReport(sent=True, tg_message_id=900))


def test_image_reply_goes_as_photo_with_caption_long_text_separately():
    long = "x" * 1025
    items = {MID: item("see screenshot", "image/png"), MID2: item(long, "image/png")}
    tg, web = FakeTelegram(), FakeWeb(outbox=items, image=PNG)
    run(tg, web, {"message_id": MID}, {"message_id": MID2})
    assert sends(tg) == [("sendPhoto", "see screenshot", 4242), ("sendPhoto", None, 4242), ("sendMessage", long, 4242)]


def test_blocked_user_is_reported_failed_and_blocked():
    tg, web = FakeTelegram(script={"sendMessage": [BLOCKED]}), FakeWeb(outbox={MID: item("hello?")})
    assert run(tg, web, {"message_id": MID}) == ["ack"]
    assert web.calls[-1] == ("report", MID, DeliveryReport(sent=False, error="Forbidden: bot was blocked by the user", blocked=True))


def test_429_waits_retry_after_and_retries_once(no_waiting):
    tg, web = FakeTelegram(script={"sendMessage": [limited(3)]}), FakeWeb(outbox={MID: item("hi")})
    run(tg, web, {"message_id": MID})
    assert [c[0] for c in tg.calls] == ["sendMessage", "sendMessage"] and no_waiting == [3]
    assert web.calls[-1] == ("report", MID, DeliveryReport(sent=True, tg_message_id=900))


def test_429_twice_fails_without_a_third_try(no_waiting):
    tg, web = FakeTelegram(script={"sendMessage": [limited(99), limited(99)]}), FakeWeb(outbox={MID: item("hi")})
    run(tg, web, {"message_id": MID})
    assert len(tg.calls) == 2 and no_waiting == [30]
    assert web.calls[-1] == ("report", MID, DeliveryReport(sent=False, error="Too Many Requests: retry after 99"))


def test_redelivered_job_is_not_sent_twice():
    tg, web = FakeTelegram(), FakeWeb(outbox={MID: item("once")})
    assert run(tg, web, {"message_id": MID}, {"message_id": MID}) == ["ack", "ack"]
    assert sends(tg) == [("sendMessage", "once", 4242)]


def test_failed_report_requeues_and_the_retry_only_reports(no_waiting):
    tg, web = FakeTelegram(), FakeWeb(outbox={MID: item("once")}, report_errors=[WebError(500, "internal_error")])
    assert run(tg, web, {"message_id": MID}, {"message_id": MID}) == [("reject", True), "ack"]
    assert sends(tg) == [("sendMessage", "once", 4242)]
    assert [c[0] for c in web.calls] == ["outbox", "report", "report"]
    assert no_waiting == [consumer.REQUEUE_DELAY]


def test_a_job_that_keeps_failing_gives_up_with_a_report():
    errors = [WebError(500, "internal_error")] * consumer.MAX_ATTEMPTS
    tg, web = FakeTelegram(), FakeWeb(outbox={MID: item("once")}, report_errors=errors)
    outcomes = run(tg, web, *[{"message_id": MID}] * consumer.MAX_ATTEMPTS)
    assert outcomes == [("reject", True)] * (consumer.MAX_ATTEMPTS - 1) + [("reject", False)]
    assert sends(tg) == [("sendMessage", "once", 4242)]
    # The last report is the give-up one; it carries what Telegram said, which web stores.
    assert web.calls[-1] == ("report", MID, DeliveryReport(sent=True, tg_message_id=900))


def test_web_unreachable_requeues_without_spending_tries():
    unreachable = [WebUnavailable("ClientConnectorError")] * (consumer.MAX_ATTEMPTS + 1)
    tg, web = FakeTelegram(), FakeWeb(outbox={MID: item("once")}, report_errors=unreachable)
    outcomes = run(tg, web, *[{"message_id": MID}] * (consumer.MAX_ATTEMPTS + 2))
    assert outcomes == [("reject", True)] * (consumer.MAX_ATTEMPTS + 1) + ["ack"]
    assert sends(tg) == [("sendMessage", "once", 4242)]


def test_missing_image_is_reported_failed_not_retried():
    class NoImage(FakeWeb):
        async def outbox_image(self, message_id):
            raise WebError(404, "support_image_not_found")

    tg, web = FakeTelegram(), NoImage(outbox={MID: item("see", "image/png")})
    assert run(tg, web, {"message_id": MID}) == ["ack"]
    assert tg.calls == []
    assert web.calls[-1] == ("report", MID, DeliveryReport(sent=False, error="image file is missing on the server"))


@pytest.mark.parametrize("payload", [b"not json", {"id": MID}, [1], {"message_id": "nope"}])
def test_malformed_job_is_dropped(payload):
    tg, web = FakeTelegram(), FakeWeb()
    assert run(tg, web, payload) == [("reject", False)]
    assert tg.calls == [] and web.calls == []
