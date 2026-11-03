import uuid
from datetime import date, datetime, timedelta
from urllib.parse import urlsplit

from pydantic import BaseModel, model_validator

from APP.constants import EmailMessageType, Locale


class EmailMessage(BaseModel):
    type: EmailMessageType
    to_email: str
    to_name: str
    data: dict
    # Язык письма; консьюмер без этого поля считает письмо русским.
    locale: Locale = Locale.RU
    notification_id: uuid.UUID | None = None
    created_at: datetime | None = None

    @model_validator(mode="after")
    def validate_legal_notification(self):
        if self.type != EmailMessageType.LEGAL_REVISION_UPDATED:
            return self
        if (self.notification_id is None or self.created_at is None
                or self.created_at.utcoffset() != timedelta(0)):
            raise ValueError("Legal notification requires stable ID and UTC created_at")
        fields = {"document_title", "document_revision", "effective_date", "document_url"}
        if set(self.data) != fields or any(not isinstance(v, str) or not v.strip() for v in self.data.values()):
            raise ValueError("Invalid legal notification data")
        if date.fromisoformat(self.data["effective_date"]).isoformat() != self.data["effective_date"]:
            raise ValueError("Expected effective_date YYYY-MM-DD")
        url = urlsplit(self.data["document_url"])
        if url.scheme not in {"http", "https"} or not url.netloc or url.username or url.password:
            raise ValueError("Legal notification requires an absolute document URL")
        return self


class TelegramJob(BaseModel):
    """A committed staff reply for the bot service to deliver (queue `telegram_out`)."""

    message_id: uuid.UUID
