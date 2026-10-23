from datetime import datetime

from pydantic import BaseModel

from APP.constants import ReleaseChannel, SubscriptionTier


class UpdateManifest(BaseModel):
    """Ответ динамического update-сервера в формате `tauri-plugin-updater`.

    Имена полей заданы плагином и менять их нельзя: клиент десериализует
    этот JSON в свою структуру и молча игнорирует ответ, который не смог
    разобрать. `signature` — содержимое `.sig` от minisign, им клиент
    проверяет скачанный инсталлятор перед запуском.

    Необязательное поле `notes` мы намеренно не отдаём: на экране обновления
    им места нет, заметки показывает сайт (`/app/releases`, `/app/latest`).
    Старые клиенты, умевшие их показывать, просто ничего не покажут.
    """

    version: str
    pub_date: datetime
    url: str
    signature: str


class LatestRelease(BaseModel):
    """Сборка для страницы загрузки."""

    version: str
    channel: ReleaseChannel
    url: str
    file_name: str
    file_size: int
    sha256: str
    published_at: datetime
    notes: str | None


class ChangelogEntry(BaseModel):
    version: str
    channel: ReleaseChannel
    published_at: datetime
    notes: str | None


class TierFeature(BaseModel):
    id: str
    allowed: bool
    min_tier: SubscriptionTier
    monthly_limit: int | None


class TierItem(BaseModel):
    id: SubscriptionTier
    features: list[TierFeature]


class TiersResponse(BaseModel):
    tiers: list[TierItem]
