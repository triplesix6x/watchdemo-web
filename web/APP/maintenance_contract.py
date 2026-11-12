"""Shared validation for the persisted, informational site notice."""
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_NOTICE_LENGTH = 500
# Deliberately plain text: no tags, Markdown formatting or link destinations.
_FORMATTING = re.compile(
    r"[<>`]|\*{1,2}[^*\n]+\*{1,2}|_{1,2}[^_\n]+_{1,2}|~~[^~\n]+~~|"
    r"(?m:^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>))|!?\[[^\]]*\]\([^)]*\)"
)
_LINK = re.compile(
    r"(?i)(?:[a-z][a-z0-9+.-]*://|www\.|mailto:|tel:|"
    r"\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\b|/)|"
    r"\b\d{1,3}(?:\.\d{1,3}){3}\b)"
)


def normalize_notice_text(value: str) -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(value) > MAX_NOTICE_LENGTH:
        raise ValueError(f"Use at most {MAX_NOTICE_LENGTH} characters")
    if any(ord(char) < 32 and char not in "\n\t" for char in value):
        raise ValueError("Use plain text without control characters")
    if _FORMATTING.search(value) or _LINK.search(value):
        raise ValueError("Use plain text without HTML, Markdown or links")
    return value


class MaintenanceNoticeSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    text_ru: str = Field(default="", max_length=MAX_NOTICE_LENGTH)
    text_en: str = Field(default="", max_length=MAX_NOTICE_LENGTH)

    @field_validator("text_ru", "text_en")
    @classmethod
    def plain_text(cls, value: str) -> str:
        return normalize_notice_text(value)

    @model_validator(mode="after")
    def require_russian_when_enabled(self) -> "MaintenanceNoticeSettings":
        if self.enabled and not self.text_ru:
            raise ValueError("Russian text is required when the notice is enabled")
        return self


class PublicMaintenanceNotice(BaseModel):
    enabled: bool
    text: str
