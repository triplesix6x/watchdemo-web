import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from API.views.auth.schemas import normalize_username
from APP.constants import Locale


class SessionResponse(BaseModel):
    id: uuid.UUID
    device_info: str | None
    ip_address: str | None
    expires_at: datetime
    last_used_at: datetime
    created_at: datetime | None
    # Сессия, которой сделан этот запрос: её нельзя «завершить» как чужую.
    is_current: bool


class UpdateProfileRequest(BaseModel):
    username: str | None = None
    locale: Locale | None = None

    @field_validator("username")
    @classmethod
    def username_valid(cls, v: str | None) -> str | None:
        return None if v is None else normalize_username(v)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(max_length=128)
    sign_out_others: bool = False


class ChangeEmailRequest(BaseModel):
    new_email: EmailStr
    password: str = Field(max_length=128)


class DeleteAccountRequest(BaseModel):
    password: str = Field(max_length=128)
    username: str = Field(max_length=50)
