"""Raw Telegram Bot API over httpx. No framework: the bot needs six methods."""

import asyncio
import logging
from functools import lru_cache
from typing import Any

import httpx

from APP.config import settings

# httpx logs every request URL at INFO, and a Bot API URL carries the token.
logging.getLogger("httpx").setLevel(logging.WARNING)

_API = "https://api.telegram.org"
# A 429 asks to wait `retry_after` seconds. Waiting longer than this inside a request is
# worse than failing: the message is marked failed and staff can resend.
MAX_RETRY_AFTER = 30


class TelegramError(Exception):
    """A Bot API failure. `status` is Telegram's error_code, or 0 when there was no answer."""

    def __init__(self, status: int, description: str, retry_after: int | None = None) -> None:
        self.status = status
        self.description = description
        self.retry_after = retry_after
        super().__init__(f"{status}: {description}")


class BotApi:
    def __init__(self, token: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._base = f"{_API}/bot{token}/"
        self._file_base = f"{_API}/file/bot{token}/"
        # Long polling holds getUpdates for up to 50 s.
        self._client = httpx.AsyncClient(transport=transport, timeout=httpx.Timeout(15, read=65))
        self.sleep = asyncio.sleep

    async def call(self, method: str, params: dict[str, Any] | None = None, files: dict | None = None) -> Any:
        try:
            if files:
                r = await self._client.post(self._base + method, data=params or {}, files=files)
            else:
                r = await self._client.post(self._base + method, json=params or {})
            body = r.json()
        except (httpx.HTTPError, ValueError) as e:
            # Never format the exception itself: its text can carry the URL, and the URL the token.
            raise TelegramError(0, f"network error: {type(e).__name__}") from None
        if body.get("ok"):
            return body["result"]
        raise TelegramError(
            int(body.get("error_code") or r.status_code),
            str(body.get("description") or ""),
            (body.get("parameters") or {}).get("retry_after"),
        )

    async def send(self, method: str, params: dict[str, Any], files: dict | None = None) -> Any:
        """`call` that honours one 429: wait `retry_after`, then try once more."""
        try:
            return await self.call(method, params, files)
        except TelegramError as e:
            if e.status != 429:
                raise
            await self.sleep(min(e.retry_after or 1, MAX_RETRY_AFTER))
            return await self.call(method, params, files)

    async def download(self, file_path: str, max_bytes: int) -> bytes | None:
        """The file's bytes, or None when it is larger than `max_bytes`."""
        chunks: list[bytes] = []
        size = 0
        try:
            async with self._client.stream("GET", self._file_base + file_path) as r:
                if r.status_code != 200:
                    raise TelegramError(r.status_code, "file download failed")
                async for chunk in r.aiter_bytes():
                    size += len(chunk)
                    if size > max_bytes:
                        return None
                    chunks.append(chunk)
        except httpx.HTTPError as e:
            raise TelegramError(0, f"network error: {type(e).__name__}") from None
        return b"".join(chunks)

    async def aclose(self) -> None:
        await self._client.aclose()


@lru_cache(maxsize=1)
def _bot(token: str) -> BotApi:
    return BotApi(token)


def get_bot() -> BotApi | None:
    """The process-wide client, or None when TELEGRAM_BOT_TOKEN is unset (bot disabled)."""
    return _bot(settings.telegram_bot_token) if settings.telegram_bot_token else None
