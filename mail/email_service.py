import asyncio
from functools import partial

import resend

from config import settings
from logger import AppLogger
from schemas import EmailMessage, EmailMessageType

logger = AppLogger.get_logger()

resend.api_key = settings.resend.api

_FROM = settings.resend.from_email


def _verify_email_html(name: str, url: str, expires_in_hours: int) -> str:
    return f"""
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
  <h2>Verify your email — WatchDemo</h2>
  <p>Hi <strong>{name}</strong>,</p>
  <p>Click the button below to verify your email address.
     The link expires in <strong>{expires_in_hours} hours</strong>.</p>
  <p style="margin:32px 0">
    <a href="{url}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">
      Verify email
    </a>
  </p>
  <p style="color:#6b7280;font-size:14px">
    If you didn't create a WatchDemo account, you can safely ignore this email.
  </p>
</body></html>
"""


def _reset_password_html(name: str, url: str, expires_in_minutes: int) -> str:
    return f"""
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
  <h2>Reset your password — WatchDemo</h2>
  <p>Hi <strong>{name}</strong>,</p>
  <p>Click the button below to reset your password.
     The link expires in <strong>{expires_in_minutes} minutes</strong>.</p>
  <p style="margin:32px 0">
    <a href="{url}" style="background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">
      Reset password
    </a>
  </p>
  <p style="color:#6b7280;font-size:14px">
    If you didn't request a password reset, you can safely ignore this email.
  </p>
</body></html>
"""


def _welcome_html(name: str) -> str:
    return f"""
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
  <h2>Welcome to WatchDemo!</h2>
  <p>Hi <strong>{name}</strong>,</p>
  <p>Your email is verified and your account is ready. Enjoy WatchDemo!</p>
</body></html>
"""


def _send_sync(params: resend.Emails.SendParams) -> None:
    resend.Emails.send(params)


async def send_email(message: EmailMessage) -> None:
    match message.type:
        case EmailMessageType.VERIFY_EMAIL:
            subject = "Verify your email — WatchDemo"
            html = _verify_email_html(
                name=message.to_name,
                url=message.data["verification_url"],
                expires_in_hours=message.data.get("expires_in_hours", 24),
            )
        case EmailMessageType.RESET_PASSWORD:
            subject = "Reset your password — WatchDemo"
            html = _reset_password_html(
                name=message.to_name,
                url=message.data["reset_url"],
                expires_in_minutes=message.data.get("expires_in_minutes", 60),
            )
        case EmailMessageType.WELCOME:
            subject = "Welcome to WatchDemo!"
            html = _welcome_html(name=message.to_name)
        case _:
            logger.warning(f"[email] unknown message type: {message.type}")
            return

    params: resend.Emails.SendParams = {
        "from": _FROM,
        "to": [message.to_email],
        "subject": subject,
        "html": html,
    }

    await asyncio.get_event_loop().run_in_executor(None, partial(_send_sync, params))
    logger.info(f"[email] sent type={message.type} to={message.to_email}")
