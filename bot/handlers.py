"""Inbound side: Telegram updates into web's support routing.

Only private chats with people count; groups, channels and bots are ignored. Every
update refreshes the contact in web, which also clears `blocked_at`.
"""

import asyncio

import aiohttp
from aiogram import Bot, F, Router
from aiogram.enums import ChatType
from aiogram.exceptions import TelegramAPIError
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

from config import settings
from logger import logger
from web_client import Contact, WebClient, WebError

MAX_IMAGE_BYTES = 10 * 1024 * 1024
IMAGE_DOCS = {"image/png", "image/jpeg", "image/webp"}
_RU_LANGS = {"ru", "uk", "be", "kk"}

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
        "retry": "Не получилось забрать картинку из Telegram. Пришлите её ещё раз.",
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
        "retry": "We could not fetch the image from Telegram. Please send it again.",
    },
}

router = Router()
_from_a_person = (F.chat.type == ChatType.PRIVATE, F.from_user, ~F.from_user.is_bot)
router.message.filter(*_from_a_person)
router.edited_message.filter(*_from_a_person)


def locale_of(language_code: str | None) -> str:
    return "ru" if (language_code or "").split("-")[0].lower() in _RU_LANGS else "en"


def help_url(locale: str) -> str:
    base = settings.app.frontend_url.rstrip("/")
    return f"{base}/help" if locale == "ru" else f"{base}/en/help"


def contact_of(m: Message) -> Contact:
    u = m.from_user
    name = " ".join(filter(None, [u.first_name, u.last_name])) or u.username or ""
    return Contact(u.id, m.chat.id, u.username, name, locale_of(u.language_code))


def _texts(m: Message) -> dict[str, str]:
    return TEXTS[locale_of(m.from_user.language_code)]


@router.message(CommandStart())
async def start(m: Message, web: WebClient) -> None:
    c, texts = contact_of(m), _texts(m)
    await web.contact(c)
    button = InlineKeyboardButton(text=texts["help_button"], url=help_url(c.locale))
    await m.answer(texts["start"], reply_markup=InlineKeyboardMarkup(inline_keyboard=[[button]]))


@router.message(F.text)
async def text(m: Message, web: WebClient) -> None:
    if await web.message(contact_of(m), m.message_id, m.text):
        await m.answer(_texts(m)["received"])


@router.message(F.photo)
async def photo(m: Message, bot: Bot, web: WebClient) -> None:
    largest = max(m.photo, key=lambda p: (p.file_size or 0, p.width * p.height))
    await _image(m, bot, web, largest.file_id, largest.file_size)


@router.message(F.document.mime_type.in_(IMAGE_DOCS))
async def image_document(m: Message, bot: Bot, web: WebClient) -> None:
    await _image(m, bot, web, m.document.file_id, m.document.file_size)


@router.message()
async def other(m: Message, web: WebClient) -> None:
    await _refuse(m, web, "unsupported")


@router.edited_message()
async def edited(m: Message, web: WebClient) -> None:
    await web.edit(contact_of(m), m.message_id, m.text or m.caption or "")


async def _refuse(m: Message, web: WebClient, key: str) -> None:
    await web.contact(contact_of(m))
    await m.answer(_texts(m)[key])


async def _image(m: Message, bot: Bot, web: WebClient, file_id: str, size: int | None) -> None:
    """Refuses an oversized image before downloading it; web checks the bytes themselves."""
    if (size or 0) > MAX_IMAGE_BYTES:
        return await _refuse(m, web, "too_large")
    try:
        file = await bot.get_file(file_id)
        if (file.file_size or 0) > MAX_IMAGE_BYTES:
            return await _refuse(m, web, "too_large")
        data = (await bot.download_file(file.file_path)).getvalue()
    except (TelegramAPIError, aiohttp.ClientError, asyncio.TimeoutError) as e:
        # Only the type: an aiohttp error's text carries the file URL, and the URL the token.
        logger.warning(f"image fetch for chat {m.chat.id} failed: {type(e).__name__}")
        return await _refuse(m, web, "retry")
    try:
        new_ticket = await web.message(contact_of(m), m.message_id, (m.caption or "").strip(), image=data)
    except WebError as e:
        if e.code == "support_image_too_large":
            return await _refuse(m, web, "too_large")
        if e.code == "support_image_invalid":
            return await _refuse(m, web, "unsupported")
        raise
    if new_ticket:
        await m.answer(_texts(m)["received"])
