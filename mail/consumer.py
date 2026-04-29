import asyncio
import json

import aio_pika
from aio_pika.abc import AbstractIncomingMessage

from config import settings
from email_service import send_email
from logger import AppLogger
from schemas import EmailMessage

logger = AppLogger.get_logger()


async def _handle_message(message: AbstractIncomingMessage) -> None:
    async with message.process(requeue=True):
        try:
            payload = json.loads(message.body.decode())
            email_msg = EmailMessage.model_validate(payload)
            await send_email(email_msg)
        except Exception as exc:
            logger.exception(f"[consumer] failed to process message: {exc}")
            raise


async def run_consumer() -> None:
    connection = await aio_pika.connect_robust(settings.rabbitmq.url)
    async with connection:
        channel = await connection.channel()
        await channel.set_qos(prefetch_count=10)

        queue = await channel.declare_queue(
            settings.rabbitmq.email_queue, durable=True
        )

        logger.info(f"[consumer] listening on queue '{settings.rabbitmq.email_queue}'")
        await queue.consume(_handle_message)

        await asyncio.Future()  # run forever
