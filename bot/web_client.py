"""web's internal support API (web/API/views/support/internal.py). web owns every ticket
rule; the bot only reports what Telegram said and delivers what web queued.

Every call is safe to repeat: web dedups messages by tg_message_id, contact and edit
writes converge, and a second delivery report is a 409. So a call that hit a web restart
or a 5xx is retried here instead of losing the customer's message.
"""

import asyncio
import json
from dataclasses import dataclass

import aiohttp
from pydantic import BaseModel

# Seconds between tries; about a minute in all, enough for `docker compose up -d web`.
RETRY_DELAYS = (1, 2, 4, 8, 15, 30)


class WebError(Exception):
    """web answered with an error status; `code` is its ErrorCode, when there is one."""

    def __init__(self, status: int, code: str | None) -> None:
        self.status, self.code = status, code
        super().__init__(f"web answered {status} {code or ''}".strip())


class WebUnavailable(Exception):
    """web could not be reached at all, after every retry."""


@dataclass(frozen=True)
class Contact:
    tg_user_id: int
    tg_chat_id: int
    username: str | None
    display_name: str
    locale: str


class OutboxItem(BaseModel):
    chat_id: int
    body: str
    image_mime: str | None


class DeliveryReport(BaseModel):
    sent: bool
    tg_message_id: int | None = None
    error: str | None = None
    blocked: bool = False


class WebClient:
    def __init__(self, base_url: str, token: str) -> None:
        self._base = base_url.rstrip("/") + "/internal/support/telegram"
        self._token = token
        self._session: aiohttp.ClientSession | None = None

    async def _request(self, method: str, path: str, form=None, **kw) -> bytes:
        """`form` builds a fresh aiohttp.FormData per try: a sent FormData cannot be reused."""
        if self._session is None:
            self._session = aiohttp.ClientSession(
                headers={"X-Internal-Token": self._token}, timeout=aiohttp.ClientTimeout(total=30)
            )
        for delay in (*RETRY_DELAYS, None):
            try:
                data = form() if form else None
                async with self._session.request(method, self._base + path, data=data, **kw) as r:
                    status, body = r.status, await r.read()
            except (aiohttp.ClientConnectionError, asyncio.TimeoutError) as e:
                if delay is None:
                    raise WebUnavailable(type(e).__name__) from None
            else:
                if status < 400:
                    return body
                if status < 500 or delay is None:
                    try:
                        code = json.loads(body).get("code")
                    except (ValueError, AttributeError):
                        code = None
                    raise WebError(status, code)
            await asyncio.sleep(delay)
        raise AssertionError("unreachable")

    @staticmethod
    def _form(c: Contact, image: bytes | None = None, **fields):
        def build() -> aiohttp.FormData:
            form = aiohttp.FormData()
            for name, value in {
                "tg_user_id": c.tg_user_id,
                "tg_chat_id": c.tg_chat_id,
                "username": c.username,
                "display_name": c.display_name,
                "locale": c.locale,
                **fields,
            }.items():
                if value is not None:
                    form.add_field(name, str(value))
            if image is not None:
                form.add_field("image", image, filename="image", content_type="application/octet-stream")
            return form

        return build

    async def contact(self, c: Contact) -> None:
        """Refreshes the contact and clears `blocked_at`, for updates that carry no message."""
        await self._request("POST", "/contact", form=self._form(c))

    async def message(self, c: Contact, tg_message_id: int, text: str, image: bytes | None = None) -> bool:
        """Routes the message; True when it opened a new ticket. A bad image raises WebError
        with code support_image_invalid or support_image_too_large."""
        form = self._form(c, image, tg_message_id=tg_message_id, text=text)
        return json.loads(await self._request("POST", "/messages", form=form))["new_ticket"]

    async def edit(self, c: Contact, tg_message_id: int, text: str) -> None:
        await self._request("POST", "/edits", form=self._form(c, tg_message_id=tg_message_id, text=text))

    async def outbox(self, message_id: str) -> OutboxItem | None:
        """The reply to send, or None when web has no such reply or it already has an outcome.
        Any other error raises: a 404 from a web without INTERNAL_API_TOKEN must not drop jobs."""
        try:
            return OutboxItem.model_validate_json(await self._request("GET", f"/outbox/{message_id}"))
        except WebError as e:
            if e.code in ("support_reply_not_found", "support_reply_settled"):
                return None
            raise

    async def outbox_image(self, message_id: str) -> bytes:
        return await self._request("GET", f"/outbox/{message_id}/image")

    async def report(self, message_id: str, report: DeliveryReport) -> None:
        """support_reply_settled means an earlier report already recorded the outcome."""
        try:
            await self._request("POST", f"/outbox/{message_id}/delivery", json=report.model_dump())
        except WebError as e:
            if e.code != "support_reply_settled":
                raise

    async def close(self) -> None:
        if self._session:
            await self._session.close()
