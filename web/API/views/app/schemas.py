from datetime import datetime

from pydantic import BaseModel


class UpdateManifest(BaseModel):
    """Ответ динамического update-сервера в формате `tauri-plugin-updater`.

    Имена полей заданы плагином и менять их нельзя: клиент десериализует
    этот JSON в свою структуру и молча игнорирует ответ, который не смог
    разобрать. `signature` — содержимое `.sig` от minisign, им клиент
    проверяет скачанный инсталлятор перед запуском.
    """

    version: str
    pub_date: datetime
    url: str
    signature: str
    notes: str | None = None
