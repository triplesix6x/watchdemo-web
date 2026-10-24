"""The real WebClient against a small aiohttp server that answers the way web does."""

import asyncio

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

import web_client
from web_client import Contact, DeliveryReport, OutboxItem, WebClient, WebError, WebUnavailable

IVAN = Contact(4242, 4242, None, "Ivan", "ru")
BASE = "/internal/support/telegram"


@pytest.fixture(autouse=True)
def fast_retries(monkeypatch):
    monkeypatch.setattr(web_client, "RETRY_DELAYS", (0, 0))


def code(status, c):
    return web.json_response({"message": "x", "code": c}, status=status)


def serve(routes, fn):
    """Runs `fn(client, seen)` against an app built from `routes`; `seen` records each request."""
    seen = []

    async def go():
        app = web.Application()
        for method, path, handler in routes:
            async def wrapped(request, handler=handler):
                form = None
                if request.content_type.startswith("multipart"):
                    form = {k: v if isinstance(v, str) else v.file.read() for k, v in (await request.post()).items()}
                seen.append((request.method, request.path, request.headers.get("X-Internal-Token"), form))
                return handler(request)

            app.router.add_route(method, BASE + path, wrapped)
        async with TestServer(app) as server:
            client = WebClient(str(server.make_url("")), "s3cret")
            try:
                return await fn(client, seen)
            finally:
                await client.close()

    return asyncio.run(go())


def test_outbox_drops_only_on_web_reply_codes():
    answers = {
        "known": lambda r: web.json_response({"chat_id": 1, "body": "hi", "image_mime": None}),
        "unknown": lambda r: code(404, "support_reply_not_found"),
        "settled": lambda r: code(409, "support_reply_settled"),
        "noauth": lambda r: code(404, "http_error"),
    }

    async def go(client, seen):
        out = {k: await client.outbox(k) for k in ("known", "unknown", "settled")}
        with pytest.raises(WebError) as e:
            await client.outbox("noauth")
        return out, (e.value.status, e.value.code), seen[0][2]

    routes = [("GET", "/outbox/{id}", lambda r: answers[r.match_info["id"]](r))]
    out, noauth, token = serve(routes, go)
    assert out == {"known": OutboxItem(chat_id=1, body="hi", image_mime=None), "unknown": None, "settled": None}
    assert noauth == (404, "http_error") and token == "s3cret"


def test_report_accepts_settled_and_raises_otherwise():
    replies = iter([code(409, "support_reply_settled"), code(404, "http_error")])

    async def go(client, seen):
        await client.report("m", DeliveryReport(sent=True, tg_message_id=7))
        with pytest.raises(WebError):
            await client.report("m", DeliveryReport(sent=True))

    serve([("POST", "/outbox/{id}/delivery", lambda r: next(replies))], go)


def test_5xx_is_retried_with_the_same_form_and_none_fields_are_left_out():
    replies = iter([web.Response(status=503), web.json_response({"new_ticket": True})])

    async def go(client, seen):
        return await client.message(IVAN, 11, "F8", image=b"\xff\xd8\xff"), seen

    new_ticket, seen = serve([("POST", "/messages", lambda r: next(replies))], go)
    assert new_ticket is True
    assert len(seen) == 2 and seen[0][3].keys() == seen[1][3].keys()
    form = seen[1][3]
    assert {k: v for k, v in form.items() if k != "image"} == {
        "tg_user_id": "4242", "tg_chat_id": "4242", "display_name": "Ivan", "locale": "ru", "tg_message_id": "11", "text": "F8",
    }
    assert form["image"] ==b"\xff\xd8\xff"


def test_4xx_is_not_retried_and_carries_the_code():
    async def go(client, seen):
        with pytest.raises(WebError) as e:
            await client.message(IVAN, 11, "", image=b"GIF89a")
        return e.value.code, len(seen)

    assert serve([("POST", "/messages", lambda r: code(422, "support_image_invalid"))], go) == ("support_image_invalid", 1)


def test_unreachable_web_raises_after_retries(monkeypatch):
    monkeypatch.setattr(web_client, "RETRY_DELAYS", (0,))  # a refused connect takes 2 s on Windows

    async def go():
        client = WebClient("http://127.0.0.1:9", "s3cret")
        try:
            with pytest.raises(WebUnavailable):
                await client.contact(IVAN)
        finally:
            await client.close()

    asyncio.run(go())
