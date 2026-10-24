"""Outbound side: staff replies from the `telegram_out` queue into Telegram.

web publishes a message id after it commits the reply. The bot reads the reply from web's
outbox, sends it and reports the outcome; web keeps the first report and answers 409 to
anything after it, so a redelivered job is dropped at the outbox read instead of sent again.
"""

import asyncio
import json

import aio_pika
from aio_pika.abc import AbstractIncomingMessage
from aiogram import Bot
from aiogram.exceptions import TelegramAPIError, TelegramForbiddenError, TelegramNetworkError, TelegramRetryAfter
from aiogram.types import BufferedInputFile

from config import settings
from logger import logger
from web_client import WebClient, WebError

TG_CAPTION_LIMIT = 1024
# A 429 asks to wait `retry_after` seconds. Longer than this, the reply is marked failed
# and staff can resend: the queue is strictly ordered, so a long wait stalls every reply.
MAX_RETRY_AFTER = 30
# Pause before a job goes back to the queue, so a web outage is not a hot loop.
REQUEUE_DELAY = 5.0

# Outcomes Telegram already gave but web has not stored yet (web was down at report time).
# ponytail: in memory, so a crash between send and report re-sends once after restart;
# a durable per-message claim in web closes that window if it ever matters.
_unreported: dict[str, dict] = {}


async def _with_one_retry(call):
    try:
        return await call()
    except TelegramRetryAfter as e:
        await asyncio.sleep(min(e.retry_after, MAX_RETRY_AFTER))
        return await call()


def _description(e: TelegramAPIError) -> str:
    if isinstance(e, TelegramRetryAfter):
        # aiogram rewrites the text; keep Telegram's own words, as for other errors.
        return e.message.rsplit("Original description: ", 1)[-1]
    if isinstance(e, TelegramNetworkError):
        return "network error"
    return e.message


async def _send(bot: Bot, web: WebClient, message_id: str, item: dict) -> dict:
    chat_id, body = item["chat_id"], item["body"]
    caption = body if len(body) <= TG_CAPTION_LIMIT else ""
    try:
        sent = None
        if item["has_image"]:
            try:
                photo = BufferedInputFile(await web.outbox_image(message_id), filename="image")
            except WebError as e:
                if e.status != 404:
                    raise
                # Retrying cannot bring the file back, and the queue waits behind this job.
                return {"sent": False, "error": "image file is missing on the server"}
            sent = await _with_one_retry(lambda: bot.send_photo(chat_id, photo, caption=caption or None))
        if body and not (item["has_image"] and caption):
            sent = await _with_one_retry(lambda: bot.send_message(chat_id, body))
        return {"sent": True, "tg_message_id": sent.message_id if sent else None}
    except TelegramAPIError as e:
        logger.warning(f"reply {message_id} not delivered: {type(e).__name__}")
        return {"sent": False, "error": _description(e)[:1000], "blocked": isinstance(e, TelegramForbiddenError)}


async def deliver(bot: Bot, web: WebClient, message_id: str) -> None:
    report = _unreported.get(message_id)
    if report is None:
        item = await web.outbox(message_id)
        if item is None:
            logger.info(f"reply {message_id} already has an outcome, dropped")
            return
        report = _unreported[message_id] = await _send(bot, web, message_id, item)
    await web.report(message_id, report)
    _unreported.pop(message_id, None)


async def handle_job(bot: Bot, web: WebClient, message: AbstractIncomingMessage) -> None:
    # ignore_processed: after a manual reject the context does not try to ack.
    async with message.process(requeue=True, ignore_processed=True):
        try:
            message_id = str(json.loads(message.body)["message_id"])
        except (ValueError, KeyError, TypeError) as exc:
            logger.error(f"[consumer] dropping malformed job: {exc!r}")
            await message.reject(requeue=False)
            return
        try:
            await deliver(bot, web, message_id)
        except Exception:
            logger.exception(f"[consumer] reply {message_id} failed, requeued")
            await asyncio.sleep(REQUEUE_DELAY)
            raise


async def run_consumer(bot: Bot, web: WebClient) -> None:
    connection = await aio_pika.connect_robust(settings.rabbitmq.url)
    async with connection:
        channel = await connection.channel()
        # One at a time: two quick replies to one chat must arrive in order.
        await channel.set_qos(prefetch_count=1)
        queue = await channel.declare_queue(settings.rabbitmq.telegram_queue, durable=True)
        logger.info(f"[consumer] listening on queue '{settings.rabbitmq.telegram_queue}'")
        await queue.consume(lambda m: handle_job(bot, web, m))
        await asyncio.Future()  # run forever
