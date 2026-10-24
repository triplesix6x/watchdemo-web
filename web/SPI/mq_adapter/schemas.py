import uuid

from pydantic import BaseModel

from APP.constants import EmailMessageType, Locale


class EmailMessage(BaseModel):
    type: EmailMessageType
    to_email: str
    to_name: str
    data: dict
    # Язык письма; консьюмер без этого поля считает письмо русским.
    locale: Locale = Locale.RU


class TelegramJob(BaseModel):
    """A committed staff reply for the bot service to deliver (queue `telegram_out`)."""

    message_id: uuid.UUID
