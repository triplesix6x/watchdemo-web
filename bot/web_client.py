"""web's internal support API (web/API/views/support/internal.py). web owns every ticket
rule; the bot only reports what Telegram said and delivers what web queued."""

import json
from dataclasses import dataclass

import aiohttp


class WebError(Exception):
    def __init__(self, status: int, code: str | None) -> None:
        self.status, self.code = status, code
        super().__init__(f"web answered {status} {code or ''}".strip())


@dataclass(frozen=True)
class Contact:
    tg_user_id: int
    tg_chat_id: int
    username: str | None
    display_name: str
    locale: str


class WebClient:
    def __init__(self, base_url: str, token: str) -> None:
        self._base = base_url.rstrip("/") + "/internal/support/telegram"
        self._token = token
        self._session: aiohttp.ClientSession | None = None

    async def _request(self, method: str, path: str, **kw) -> bytes:
        if self._session is None:
            self._session = aiohttp.ClientSession(
                headers={"X-Internal-Token": self._token}, timeout=aiohttp.ClientTimeout(total=30)
            )
        async with self._session.request(method, self._base + path, **kw) as r:
            body = await r.read()
        if r.status >= 400:
            try:
                code = json.loads(body).get("code")
            except (ValueError, AttributeError):
                code = None
            raise WebError(r.status, code)
        return body

    @staticmethod
    def _form(c: Contact, **fields) -> aiohttp.FormData:
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
        return form

    async def contact(self, c: Contact) -> None:
        """Refreshes the contact and clears `blocked_at`, for updates that carry no message."""
        await self._request("POST", "/contact", data=self._form(c))

    async def message(self, c: Contact, tg_message_id: int, text: str, image: bytes | None = None) -> bool:
        """Routes the message; True when it opened a new ticket. A bad image raises WebError
        with code support_image_invalid or support_image_too_large."""
        form = self._form(c, tg_message_id=tg_message_id, text=text)
        if image is not None:
            form.add_field("image", image, filename="image", content_type="application/octet-stream")
        return json.loads(await self._request("POST", "/messages", data=form))["new_ticket"]

    async def edit(self, c: Contact, tg_message_id: int, text: str) -> None:
        await self._request("POST", "/edits", data=self._form(c, tg_message_id=tg_message_id, text=text))

    async def outbox(self, message_id: str) -> dict | None:
        """{chat_id, body, has_image}, or None when the reply is unknown or already has an outcome."""
        try:
            return json.loads(await self._request("GET", f"/outbox/{message_id}"))
        except WebError as e:
            if e.status in (404, 409):
                return None
            raise

    async def outbox_image(self, message_id: str) -> bytes:
        return await self._request("GET", f"/outbox/{message_id}/image")

    async def report(self, message_id: str, report: dict) -> None:
        """409 means an earlier report already recorded the outcome; that is success too."""
        try:
            await self._request("POST", f"/outbox/{message_id}/delivery", json=report)
        except WebError as e:
            if e.status != 409:
                raise

    async def close(self) -> None:
        if self._session:
            await self._session.close()
