"""Outbound side: staff replies from the `telegram_out` queue into Telegram.

web publishes a message id after it commits the reply. The bot reads the reply from web's
outbox, sends it and reports the outcome; web keeps the first report and answers 409 to
anything after it, so a redelivered job is dropped at the outbox read instead of sent again.
"""

import asyncio
import uuid

import aio_pika
from aio_pika.abc import AbstractIncomingMessage
from aiogram import Bot
from aiogram.exceptions import TelegramAPIError, TelegramForbiddenError, TelegramNetworkError, TelegramRetryAfter
from aiogram.types import BufferedInputFile
from pydantic import BaseModel, ValidationError

from config import settings
from logger import logger
from web_client import DeliveryReport, OutboxItem, WebClient, WebError, WebUnavailable

TG_CAPTION_LIMIT = 1024
# A 429 asks to wait `retry_after` seconds; the wait is capped here and then the send is
# tried once more, because the queue is strictly ordered and a long wait stalls every reply.
MAX_RETRY_AFTER = 30
# Pause before a job goes back to the queue, so an outage is not a hot loop.
REQUEUE_DELAY = 5.0
# Failures other than "web is unreachable" give up after this many tries: one broken job
# must not hold the queue (prefetch 1) forever.
MAX_ATTEMPTS = 5

# Outcomes Telegram already gave but web has not stored yet (web was down at report time).
# ponytail: in memory, so a crash or a stop between send and report re-sends that reply
# once after restart; a durable per-message claim in web closes that window if it matters.
_unreported: dict[str, DeliveryReport] = {}
_attempts: dict[str, int] = {}


class TelegramJob(BaseModel):
    """web's SPI/mq_adapter/schemas.py TelegramJob."""

    message_id: uuid.UUID


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


async def _send(bot: Bot, web: WebClient, message_id: str, item: OutboxItem) -> DeliveryReport:
    photo = None
    if item.image_mime:
        try:
            data = await web.outbox_image(message_id)
        except WebError as e:
            if e.code != "support_image_not_found":
                raise
            # Retrying cannot bring the file back.
            return DeliveryReport(sent=False, error="image file is missing on the server")
        photo = BufferedInputFile(data, filename=f"image.{item.image_mime.split('/')[-1]}")
    caption_fits = len(item.body) <= TG_CAPTION_LIMIT
    try:
        if photo:
            caption = item.body if caption_fits else ""
            sent = await _with_one_retry(lambda: bot.send_photo(item.chat_id, photo, caption=caption or None))
        if not photo or not caption_fits:
            sent = await _with_one_retry(lambda: bot.send_message(item.chat_id, item.body))
    except TelegramAPIError as e:
        logger.warning(f"reply {message_id} not delivered: {type(e).__name__}")
        return DeliveryReport(sent=False, error=_description(e)[:1000], blocked=isinstance(e, TelegramForbiddenError))
    return DeliveryReport(sent=True, tg_message_id=sent.message_id)


async def deliver(bot: Bot, web: WebClient, message_id: str) -> None:
    report = _unreported.get(message_id)
    if report is None:
        item = await web.outbox(message_id)
        if item is None:
            logger.info(f"reply {message_id} is unknown or already has an outcome, dropped")
            return
        report = _unreported[message_id] = await _send(bot, web, message_id, item)
    await web.report(message_id, report)
    _unreported.pop(message_id, None)


async def _give_up(web: WebClient, message_id: str, exc: Exception) -> None:
    report = _unreported.pop(message_id, None) or DeliveryReport(sent=False, error=f"bot gave up: {type(exc).__name__}")
    try:
        await web.report(message_id, report)
    except Exception as e:
        logger.error(f"[consumer] reply {message_id} dropped without a report: {e!r}")


async def handle_job(bot: Bot, web: WebClient, message: AbstractIncomingMessage) -> None:
    # ignore_processed: after a manual reject the context does not try to ack.
    async with message.process(requeue=True, ignore_processed=True):
        try:
            message_id = str(TelegramJob.model_validate_json(message.body).message_id)
        except ValidationError as exc:
            logger.error(f"[consumer] dropping malformed job: {exc.errors()[0]['msg']}")
            await message.reject(requeue=False)
            return
        try:
            await deliver(bot, web, message_id)
        except WebUnavailable:
            logger.warning(f"[consumer] web unreachable, reply {message_id} requeued")
        except Exception as exc:
            attempts = _attempts[message_id] = _attempts.get(message_id, 0) + 1
            logger.exception(f"[consumer] reply {message_id} failed (try {attempts} of {MAX_ATTEMPTS})")
            if attempts >= MAX_ATTEMPTS:
                _attempts.pop(message_id)
                await _give_up(web, message_id, exc)
                await message.reject(requeue=False)
                return
        else:
            _attempts.pop(message_id, None)
            return
        await asyncio.sleep(REQUEUE_DELAY)
        await message.reject(requeue=True)


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
