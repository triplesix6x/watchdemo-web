"""Telegram side of support: turns Bot API updates into inbound support messages.

The webhook (API/views/support/views.py) and the dev poller (APP/telegram_poll.py) both
call `handle_update`. Only private chats count; groups and channels are ignored.
"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from APP.config import settings
from APP.exceptions import ValidationError
from APP.logger import AppLogger
from APP.services import support_service as svc
from SPI.db_adapter.models.support import SupportMessageModel, SupportTicketModel
from SPI.telegram_adapter.bot_api import BotApi, TelegramError

logger = AppLogger.get_logger()

ALLOWED_UPDATES = ["message", "edited_message"]
_RU_LANGS = {"ru", "uk", "be", "kk"}
_IMAGE_DOCS = {"image/png", "image/jpeg", "image/webp"}

TEXTS = {
    "ru": {
        "start": (
            "Здравствуйте! Это поддержка WatchDemo.\n\n"
            "Многие ответы уже есть на странице «Помощь», загляните туда сначала. "
            "Если ответа нет, напишите сюда: любое сообщение в этом чате попадёт в поддержку."
        ),
        "help_button": "Открыть «Помощь»",
        "received": "Сообщение получили. Ответим здесь, в этом чате.",
        "unsupported": "Поддержка принимает только текст и картинки (PNG, JPEG, WebP).",
        "too_large": "Картинка больше 10 МБ. Пришлите поменьше или сожмите её.",
    },
    "en": {
        "start": (
            "Hi! This is WatchDemo support.\n\n"
            "Many answers are already on the Help page, so please check it first. "
            "If yours is not there, write here: every message in this chat reaches support."
        ),
        "help_button": "Open Help",
        "received": "Got your message. We will answer here, in this chat.",
        "unsupported": "Support accepts only text and images (PNG, JPEG, WebP).",
        "too_large": "The image is over 10 MB. Send a smaller one or compress it.",
    },
}


def locale_of(language_code: str | None) -> str:
    return "ru" if (language_code or "").split("-")[0].lower() in _RU_LANGS else "en"


def help_url(locale: str) -> str:
    base = settings.app.frontend_url.rstrip("/")
    return f"{base}/help" if locale == "ru" else f"{base}/en/help"


async def _say(bot: BotApi, chat_id: int, text: str, markup: dict | None = None) -> None:
    params: dict = {"chat_id": chat_id, "text": text}
    if markup:
        params["reply_markup"] = markup
    try:
        await bot.send("sendMessage", params)
    except TelegramError as e:
        logger.warning(f"telegram auto-reply to {chat_id} failed: {e}")


async def _inbound_message(session: AsyncSession, contact_id, tg_message_id: int) -> SupportMessageModel | None:
    return await session.scalar(
        select(SupportMessageModel)
        .join(SupportTicketModel, SupportTicketModel.id == SupportMessageModel.ticket_id)
        .where(
            SupportTicketModel.contact_id == contact_id,
            SupportMessageModel.tg_message_id == tg_message_id,
            SupportMessageModel.direction == svc.Direction.IN,
        )
    )


def _image_file(msg: dict) -> dict | None:
    """The file to fetch: the largest photo size, or a document that is an image."""
    if msg.get("photo"):
        return max(msg["photo"], key=lambda p: (p.get("file_size") or 0, p.get("width", 0) * p.get("height", 0)))
    doc = msg.get("document")
    if doc and doc.get("mime_type") in _IMAGE_DOCS:
        return doc
    return None


async def handle_update(session: AsyncSession, bot: BotApi, update: dict, now: datetime | None = None) -> None:
    edited = "message" not in update and "edited_message" in update
    msg = update.get("edited_message") if edited else update.get("message")
    if not isinstance(msg, dict):
        return
    chat, sender = msg.get("chat") or {}, msg.get("from") or {}
    if chat.get("type") != "private" or sender.get("is_bot") or not sender.get("id"):
        return
    locale = locale_of(sender.get("language_code"))
    texts = TEXTS[locale]
    name = " ".join(filter(None, [sender.get("first_name"), sender.get("last_name")])) or sender.get("username") or ""
    contact = await svc.telegram_contact(session, sender["id"], chat["id"], sender.get("username"), name, locale)

    if edited:
        original = await _inbound_message(session, contact.id, msg.get("message_id"))
        if original:
            original.body = msg.get("text") or msg.get("caption") or ""
            original.edited_at = now or svc.utcnow()
        return

    text = msg.get("text")
    if text and text.split()[0].split("@")[0] == "/start":
        button = {"inline_keyboard": [[{"text": texts["help_button"], "url": help_url(locale)}]]}
        await _say(bot, chat["id"], texts["start"], button)
        return
    # Telegram redelivers an update it thinks we missed; the message id makes that a no-op.
    if await _inbound_message(session, contact.id, msg.get("message_id")):
        return

    image = None
    file = _image_file(msg)
    if file:
        if (file.get("file_size") or 0) > svc.MAX_IMAGE_BYTES:
            await _say(bot, chat["id"], texts["too_large"])
            return
        info = await bot.send("getFile", {"file_id": file["file_id"]})
        data = await bot.download(info["file_path"], svc.MAX_IMAGE_BYTES)
        if data is None:
            await _say(bot, chat["id"], texts["too_large"])
            return
        try:
            image = svc.sniff_image(data)
        except ValidationError:
            await _say(bot, chat["id"], texts["unsupported"])
            return
    elif not text:
        await _say(bot, chat["id"], texts["unsupported"])
        return

    body = (text or msg.get("caption") or "").strip()
    routed = await svc.route_inbound(
        session, contact, body, image=image, tg_message_id=msg.get("message_id"), now=now
    )
    if routed.new_ticket:
        await _say(bot, chat["id"], texts["received"])
