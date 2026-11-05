"""Shared URL guard for service-email links (including local preview URLs)."""
from urllib.parse import urlsplit


def safe_url(value: str) -> str:
    if not isinstance(value, str) or not value or any(
        c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "\\" for c in value
    ):
        raise ValueError("invalid email URL")
    try:
        parts = urlsplit(value)
        port = parts.port  # Reject malformed/out-of-range ports too.
    except ValueError:
        raise ValueError("invalid email URL") from None
    if parts.scheme not in ("https", "http") or not parts.hostname or parts.username or parts.password:
        raise ValueError("invalid email URL")
    return value
