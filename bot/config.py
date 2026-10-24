from urllib.parse import quote

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


class RabbitMQConfig(BaseModel):
    host: str
    port: int = 5672
    user: str
    password: str
    vhost: str = "/"
    # Staff replies published by web: {"message_id": "<uuid>"}.
    telegram_queue: str = "telegram_out"

    @property
    def url(self) -> str:
        return f"amqp://{self.user}:{quote(self.password)}@{self.host}:{self.port}{self.vhost}"


class AppConfig(BaseModel):
    frontend_url: str = "https://watchdemo.pro"


class Settings(BaseSettings):
    telegram_bot_token: str
    # Sent to web as X-Internal-Token; the same value as web's INTERNAL_API_TOKEN.
    internal_api_token: str
    # web on the docker `internal` network. Its internal API lives outside /api.
    web_url: str = "http://web:8000"
    rabbitmq: RabbitMQConfig
    app: AppConfig = AppConfig()

    model_config = SettingsConfigDict(
        case_sensitive=False,
        env_nested_delimiter="__",
        env_file=[".env", "../.env"],
        # The root .env also holds every other service's settings.
        extra="ignore",
    )


settings = Settings()
