import uuid

import aio_pika
from aio_pika import DeliveryMode, Message

from APP.config import settings
from APP.logger import AppLogger
from SPI.mq_adapter.schemas import EmailMessage

logger = AppLogger.get_logger()


class MQPublisher:
    def __init__(self) -> None:
        self._connection: aio_pika.abc.AbstractRobustConnection | None = None
        self._channel: aio_pika.abc.AbstractChannel | None = None

    async def connect(self) -> None:
        self._connection = await aio_pika.connect_robust(settings.rabbitmq.url)
        self._channel = await self._connection.channel()
        for queue in (settings.rabbitmq.email_queue, settings.rabbitmq.telegram_queue):
            await self._channel.declare_queue(queue, durable=True)
        logger.info("[mq] connected to RabbitMQ")

    async def close(self) -> None:
        if self._connection:
            await self._connection.close()
            logger.info("[mq] connection closed")

    async def _publish(self, queue: str, body: bytes) -> None:
        if not self._channel:
            raise RuntimeError("MQ channel not initialized")
        await self._channel.default_exchange.publish(
            Message(
                body=body,
                delivery_mode=DeliveryMode.PERSISTENT,
                content_type="application/json",
            ),
            routing_key=queue,
        )

    async def publish_email(self, message: EmailMessage) -> None:
        await self._publish(settings.rabbitmq.email_queue, message.model_dump_json().encode())
        logger.info(f"[mq] published email message type={message.type} to={message.to_email}")

    async def publish_telegram(self, message_id: uuid.UUID) -> None:
        await self._publish(settings.rabbitmq.telegram_queue, f'{{"message_id": "{message_id}"}}'.encode())
        logger.info(f"[mq] published telegram reply {message_id}")
