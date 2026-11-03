from datetime import date, datetime, timedelta
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from urls import safe_url


class EmailMessageType(StrEnum):
    VERIFY_EMAIL = "verify_email"
    RESET_PASSWORD = "reset_password"
    WELCOME = "welcome"
    EMAIL_CHANGE_CONFIRM = "email_change_confirm"
    EMAIL_CHANGE_NOTICE = "email_change_notice"
    PASSWORD_CHANGED = "password_changed"
    LEGAL_REVISION_UPDATED = "legal_revision_updated"


class LegalRevisionData(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", strict=True)

    document_title: str
    document_revision: str
    effective_date: str
    document_url: str

    @field_validator("document_title", "document_revision")
    @classmethod
    def nonempty(cls, value: str) -> str:
        if not value.strip() or any(ord(c) < 32 for c in value):
            raise ValueError("invalid document metadata")
        return value

    @field_validator("effective_date")
    @classmethod
    def iso_date(cls, value: str) -> str:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError("expected ISO date")
        return value

    @field_validator("document_url")
    @classmethod
    def document_link(cls, value: str) -> str:
        return safe_url(value)


class EmailMessage(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: EmailMessageType
    to_email: str
    to_name: str
    data: dict | LegalRevisionData
    # Old web jobs have neither locale nor notification metadata.
    locale: str = "ru"
    notification_id: UUID | None = None
    created_at: datetime | None = None

    @model_validator(mode="before")
    @classmethod
    def legal_contract(cls, value):
        if isinstance(value, dict) and value.get("type") == EmailMessageType.LEGAL_REVISION_UPDATED:
            required = {"type", "notification_id", "created_at", "to_email", "to_name", "locale", "data"}
            if set(value) != required or value.get("locale") not in ("ru", "en"):
                raise ValueError("invalid legal notification envelope")
            if not isinstance(value.get("created_at"), (str, datetime)):
                raise ValueError("expected UTC ISO timestamp")
            value = dict(value)
            if isinstance(value["created_at"], str):
                value["created_at"] = datetime.fromisoformat(value["created_at"])
            value["data"] = LegalRevisionData.model_validate(value["data"])
        return value

    @model_validator(mode="after")
    def legal_metadata(self):
        if self.type == EmailMessageType.LEGAL_REVISION_UPDATED:
            if self.notification_id is None or self.created_at is None:
                raise ValueError("legal notification metadata required")
            if self.created_at.tzinfo is None or self.created_at.utcoffset() != timedelta(0):
                raise ValueError("expected UTC ISO timestamp")
            if not self.to_email.strip() or "@" not in self.to_email or any(
                c.isspace() or ord(c) < 32 for c in self.to_email
            ):
                raise ValueError("invalid recipient")
            if not isinstance(self.data, LegalRevisionData):
                raise ValueError("legal document data required")
        return self
