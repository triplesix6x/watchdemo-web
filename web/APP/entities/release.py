import uuid
from datetime import datetime

from APP.constants import ReleaseChannel
from APP.entities.base import Entity


class ReleaseEntity(Entity):
    id: uuid.UUID
    version: str
    channel: ReleaseChannel
    target: str
    arch: str
    file_name: str
    file_path: str
    file_size: int
    sha256: str
    signature: str
    notes: str | None
    show_in_changelog: bool = True
    published_at: datetime
    published_by: uuid.UUID | None
