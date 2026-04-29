from enum import StrEnum

from pydantic import BaseModel


class EmailMessageType(StrEnum):
    VERIFY_EMAIL = "verify_email"
    RESET_PASSWORD = "reset_password"
    WELCOME = "welcome"


class EmailMessage(BaseModel):
    type: EmailMessageType
    to_email: str
    to_name: str
    data: dict
