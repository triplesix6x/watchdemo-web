"""UTC periods anchored independently to the original activation, not 30 days."""
from calendar import monthrange
from datetime import datetime, timezone


def activation_month(anchor: datetime, offset: int) -> datetime:
    absolute = anchor.year * 12 + anchor.month - 1 + offset
    year, month0 = divmod(absolute, 12)
    month = month0 + 1
    return anchor.replace(year=year, month=month, day=min(anchor.day, monthrange(year, month)[1]))


def quota_period(now: datetime, anchor: datetime | None) -> tuple[datetime, datetime]:
    now = now.astimezone(timezone.utc)
    if anchor is None:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return start, activation_month(start, 1)
    anchor = anchor.astimezone(timezone.utc)
    offset = (now.year - anchor.year) * 12 + now.month - anchor.month
    if activation_month(anchor, offset) > now:
        offset -= 1
    return activation_month(anchor, offset), activation_month(anchor, offset + 1)
