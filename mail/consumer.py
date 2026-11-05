import asyncio
from datetime import datetime, timedelta, timezone
from functools import partial
import json
from uuid import UUID

import aio_pika
from aio_pika.abc import AbstractChannel, AbstractIncomingMessage

from config import settings
from email_service import send_email
from logger import AppLogger
from schemas import EmailMessage, EmailMessageType

logger = AppLogger.get_logger()
LEGAL_TYPE = EmailMessageType.LEGAL_REVISION_UPDATED
LEGAL_MAX_ATTEMPTS = 5
LEGAL_MAX_AGE = timedelta(hours=1)
LEGAL_RETRY_DELAY_MS = 60_000
ATTEMPT_HEADER = "x-mail-attempt"
REASON_HEADER = "x-mail-failure-reason"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _notification_id(payload: dict) -> str | None:
    try:
        return str(UUID(str(payload.get("notification_id"))))
    except (ValueError, TypeError, AttributeError):
        return None


async def _store(
    message: AbstractIncomingMessage, channel: AbstractChannel,
    *, failed: bool, attempts: int, reason: str, notification_id: str | None,
) -> None:
    # Confirm durable ownership before ack. Failure raises through ProcessContext,
    # which requeues the original. A lost confirm can duplicate the stored copy.
    queue_name = settings.rabbitmq.email_queue + (".legal.failed" if failed else ".legal.retry")
    outgoing = aio_pika.Message(
        body=message.body,
        content_type="application/json",
        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        headers={**(message.headers or {}), ATTEMPT_HEADER: attempts, REASON_HEADER: reason},
        message_id=notification_id,
    )
    try:
        confirmed = await channel.default_exchange.publish(outgoing, routing_key=queue_name, mandatory=True)
    except Exception:
        # Broker exception representations may include the original message.
        raise RuntimeError("mail storage publication failed") from None
    if not confirmed:
        raise RuntimeError("mail storage publication not confirmed")
    await message.ack()
    logger.warning("event=legal_notice_stored type=%s notification_id=%s reason=%s attempts=%s destination=%s",
                   LEGAL_TYPE, notification_id, reason, attempts, "failed" if failed else "retry")


async def _handle_legal(message: AbstractIncomingMessage, payload: dict, channel: AbstractChannel) -> None:
    notification_id = _notification_id(payload)
    attempts = 0
    try:
        attempts = (message.headers or {}).get(ATTEMPT_HEADER, 0)
        if type(attempts) is not int or attempts < 0:
            raise ValueError("invalid attempt count")
        email_msg = EmailMessage.model_validate(payload)
    except (KeyError, ValueError, TypeError):
        await _store(message, channel, failed=True, attempts=attempts if type(attempts) is int else 0,
                     reason="malformed", notification_id=notification_id)
        return

    reason = None
    now = _now()
    if email_msg.created_at > now:
        reason = "future_created_at"
    elif now - email_msg.created_at >= LEGAL_MAX_AGE:
        reason = "expired_outcome_unknown"
    elif attempts >= LEGAL_MAX_ATTEMPTS:
        reason = "attempts_exhausted"
    if reason:
        await _store(message, channel, failed=True, attempts=attempts, reason=reason, notification_id=notification_id)
        return

    try:
        await send_email(email_msg)
    except (KeyError, ValueError):
        # Rendering/validation errors do not become repeated provider requests.
        await _store(message, channel, failed=True, attempts=attempts + 1,
                     reason="invalid_payload_or_provider_rejection", notification_id=notification_id)
    except Exception:
        attempts += 1
        expired = _now() - email_msg.created_at >= LEGAL_MAX_AGE
        failed = expired or attempts >= LEGAL_MAX_ATTEMPTS
        reason = "expired_outcome_unknown" if expired else "attempts_exhausted" if failed else "provider_error"
        await _store(message, channel, failed=failed, attempts=attempts, reason=reason, notification_id=notification_id)


async def _handle_message(message: AbstractIncomingMessage, channel: AbstractChannel | None = None) -> None:
    async with message.process(requeue=True, ignore_processed=True):
        try:
            payload = json.loads(message.body.decode())
        except (ValueError, UnicodeError):
            logger.error("event=email_rejected reason=invalid_json type=unknown notification_id=none")
            await message.reject(requeue=False)
            return
        if isinstance(payload, dict) and payload.get("type") == LEGAL_TYPE:
            if channel is None:
                raise RuntimeError("legal storage channel required")
            await _handle_legal(message, payload, channel)
            return
        try:
            email_msg = EmailMessage.model_validate(payload)
            await send_email(email_msg)
        except (KeyError, ValueError):
            logger.error("event=email_rejected reason=malformed type=legacy_or_unknown notification_id=none")
            await message.reject(requeue=False)
        except Exception:
            # Never log provider exception strings: they can contain addresses/tokens.
            logger.error("event=email_retry reason=provider_error type=legacy_or_unknown notification_id=none")
            raise RuntimeError("email provider failure") from None


async def _declare_queues(channel: AbstractChannel):
    # Do not retrofit DLX arguments onto the deployed email queue.
    queue = await channel.declare_queue(settings.rabbitmq.email_queue, durable=True)
    await channel.declare_queue(settings.rabbitmq.email_queue + ".legal.retry", durable=True, arguments={
        "x-message-ttl": LEGAL_RETRY_DELAY_MS,
        # RabbitMQ 3.13 in compose supports confirmed at-least-once DLX.
        "x-queue-type": "quorum",
        "x-dead-letter-strategy": "at-least-once",
        "x-overflow": "reject-publish",
        "x-dead-letter-exchange": "",
        "x-dead-letter-routing-key": settings.rabbitmq.email_queue,
    })
    await channel.declare_queue(settings.rabbitmq.email_queue + ".legal.failed", durable=True)
    return queue


async def run_consumer() -> None:
    connection = await aio_pika.connect_robust(settings.rabbitmq.url)
    async with connection:
        channel = await connection.channel(publisher_confirms=True, on_return_raises=True)
        await channel.set_qos(prefetch_count=10)
        queue = await _declare_queues(channel)
        logger.info("event=email_consumer_started")
        await queue.consume(partial(_handle_message, channel=channel))
        await asyncio.Future()
