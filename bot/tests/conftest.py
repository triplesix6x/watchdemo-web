import json
import os
import sys
from pathlib import Path

# Settings() reads the environment at import time; tests never reach Telegram, web or RabbitMQ.
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "123456:TEST")
os.environ.setdefault("INTERNAL_API_TOKEN", "internal-test")
os.environ.setdefault("RABBITMQ__HOST", "localhost")
os.environ.setdefault("RABBITMQ__USER", "test")
os.environ.setdefault("RABBITMQ__PASSWORD", "test")
os.environ.setdefault("APP__FRONTEND_URL", "https://watchdemo.pro")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aiogram import Bot  # noqa: E402
from aiogram.client.session.base import BaseSession  # noqa: E402

from web_client import WebError  # noqa: E402

SENT = {"message_id": 900, "date": 0, "chat": {"id": 4242, "type": "private"}}
BLOCKED = (403, {"ok": False, "error_code": 403, "description": "Forbidden: bot was blocked by the user"})


def limited(seconds):
    return 429, {
        "ok": False,
        "error_code": 429,
        "description": f"Too Many Requests: retry after {seconds}",
        "parameters": {"retry_after": seconds},
    }


class FakeTelegram(BaseSession):
    """A Bot session that answers from a script instead of the network. Each answer goes
    through aiogram's own response parsing, so error codes become the real exceptions.

    `script[api_method]` is a list of (status, body) answers used in order; methods
    without a script answer ok with a sent message."""

    def __init__(self, script=None, files=None):
        super().__init__()
        self.script = {k: list(v) for k, v in (script or {}).items()}
        self.files = files or {}
        self.calls: list[tuple[str, dict]] = []

    async def make_request(self, bot, method, timeout=None):
        name = method.__api_method__
        params = method.model_dump(exclude_none=True, exclude={"photo"})
        self.calls.append((name, params))
        if self.script.get(name):
            status, body = self.script[name].pop(0)
        elif name == "getMe":
            status, body = 200, {"ok": True, "result": {"id": 1, "is_bot": True, "first_name": "Bot", "username": "watchdemopro_bot"}}
        elif name == "getFile":
            fid = params["file_id"]
            result = {"file_id": fid, "file_unique_id": fid, "file_size": len(self.files.get(fid, b"")), "file_path": f"photos/{fid}"}
            status, body = 200, {"ok": True, "result": result}
        else:
            status, body = 200, {"ok": True, "result": SENT}
        return self.check_response(bot, method, status, json.dumps(body)).result

    async def stream_content(self, url, headers=None, timeout=30, chunk_size=65536, raise_for_status=True):
        name = url.rsplit("/", 1)[-1]
        self.calls.append(("download", {"file": name}))
        yield self.files[name]

    async def close(self):
        pass


def fake_bot(tg: FakeTelegram) -> Bot:
    return Bot("123456:TEST", session=tg)


class FakeWeb:
    """Stands in for WebClient and records what the bot told web."""

    def __init__(self, new_ticket=True, outbox=None, image=b"", message_error=None, report_errors=0):
        self.new_ticket, self.items, self.image = new_ticket, outbox or {}, image
        self.message_error, self.report_errors = message_error, report_errors
        self.calls: list[tuple] = []

    async def contact(self, c):
        self.calls.append(("contact", c.tg_user_id, c.locale))

    async def message(self, c, tg_message_id, text, image=None):
        self.calls.append(("message", tg_message_id, text, image))
        if self.message_error:
            raise WebError(422, self.message_error)
        return self.new_ticket

    async def edit(self, c, tg_message_id, text):
        self.calls.append(("edit", tg_message_id, text))

    async def outbox(self, message_id):
        self.calls.append(("outbox", message_id))
        return self.items.get(message_id)

    async def outbox_image(self, message_id):
        return self.image

    async def report(self, message_id, report):
        self.calls.append(("report", message_id, report))
        if self.report_errors:
            self.report_errors -= 1
            raise WebError(502, None)
        # web keeps the first report; later ones are 409, which WebClient treats as done.
        self.items.pop(message_id, None)
