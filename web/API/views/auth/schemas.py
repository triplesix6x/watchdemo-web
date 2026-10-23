import uuid
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, field_validator

from APP.constants import Locale, SubscriptionTier, UserRole


def normalize_username(v: str) -> str:
    """Правила имени пользователя: 3-50 символов, буквы, цифры, _ и -."""
    v = v.strip()
    if len(v) < 3 or len(v) > 50:
        raise ValueError("Username must be 3–50 characters")
    if not v.replace("_", "").replace("-", "").isalnum():
        raise ValueError("Username may only contain letters, digits, _ and -")
    return v.lower()


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str
    password: str = Field(max_length=128)
    locale: Locale = Locale.RU

    @field_validator("username")
    @classmethod
    def username_valid(cls, v: str) -> str:
        return normalize_username(v)


class LoginRequest(BaseModel):
    login: str = Field(max_length=255)
    password: str = Field(max_length=128)


class SubscriptionResponse(BaseModel):
    tier: SubscriptionTier
    effective_tier: SubscriptionTier
    started_at: datetime
    expires_at: datetime | None
    is_expired: bool


class UserResponse(BaseModel):
    """Профиль пользователя: ответ `/users/me` и поле `user` при входе."""

    id: uuid.UUID
    email: str
    username: str
    role: UserRole
    is_verified: bool
    is_beta_tester: bool
    locale: Locale
    created_at: datetime | None
    subscription: SubscriptionResponse | None


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse


class TokenRefreshRequest(BaseModel):
    # Optional: browser clients rely on httpOnly cookie; non-browser clients send token in body
    refresh_token: str | None = Field(default=None, max_length=128)


class TokenRefreshResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(max_length=128)
    new_password: str = Field(max_length=128)


class ResendVerificationRequest(BaseModel):
    email: EmailStr
