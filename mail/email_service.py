import asyncio
from functools import partial

import resend

from config import settings
from logger import AppLogger
from schemas import EmailMessage, EmailMessageType, LegalRevisionData
from templates import render

logger = AppLogger.get_logger()
resend.api_key = settings.resend.api
_FROM = settings.resend.from_email


def _send_sync(params: resend.Emails.SendParams, options: resend.Emails.SendOptions | None) -> None:
    resend.Emails.send(params, options)


async def send_email(message: EmailMessage) -> None:
    data = message.data.model_dump() if isinstance(message.data, LegalRevisionData) else message.data
    subject, html, text = render(str(message.type), message.locale, message.to_name, data)
    params: resend.Emails.SendParams = {
        "from": _FROM,
        "to": [message.to_email],
        "subject": subject,
        "html": html,
        "text": text,
    }
    options: resend.Emails.SendOptions | None = None
    if message.type == EmailMessageType.LEGAL_REVISION_UPDATED:
        options = {"idempotency_key": f"legal-notice/{message.notification_id}"}
    await asyncio.get_running_loop().run_in_executor(None, partial(_send_sync, params, options))
    logger.info("event=email_submitted type=%s notification_id=%s locale=%s",
                message.type, message.notification_id, message.locale if message.locale in ("ru", "en") else "ru")
