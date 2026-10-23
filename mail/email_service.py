import asyncio
from functools import partial

import resend

from config import settings
from logger import AppLogger
from schemas import EmailMessage
from templates import TEMPLATES, render

logger = AppLogger.get_logger()

resend.api_key = settings.resend.api

_FROM = settings.resend.from_email


def _send_sync(params: resend.Emails.SendParams) -> None:
    resend.Emails.send(params)


async def send_email(message: EmailMessage) -> None:
    if message.type not in TEMPLATES:
        logger.warning(f"[email] unknown message type: {message.type}")
        return
    subject, html, text = render(
        str(message.type), message.locale, message.to_name, message.data
    )

    params: resend.Emails.SendParams = {
        "from": _FROM,
        "to": [message.to_email],
        "subject": subject,
        "html": html,
        "text": text,
    }

    await asyncio.get_event_loop().run_in_executor(None, partial(_send_sync, params))
    logger.info(f"[email] sent type={message.type} locale={message.locale} to={message.to_email}")
