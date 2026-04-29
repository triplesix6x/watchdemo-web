from urllib.parse import quote

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


class RabbitMQConfig(BaseModel):
    host: str
    port: int = 5672
    user: str
    password: str
    vhost: str = "/"
    email_queue: str = "email"

    @property
    def url(self) -> str:
        return f"amqp://{self.user}:{quote(self.password)}@{self.host}:{self.port}{self.vhost}"


class ResendConfig(BaseModel):
    api: str
    from_email: str = "WatchDemo <noreply@watchdemo.io>"


class Settings(BaseSettings):
    rabbitmq: RabbitMQConfig
    resend: ResendConfig

    model_config = SettingsConfigDict(
        case_sensitive=False,
        env_nested_delimiter="__",
        env_file=[".env", "../.env"],
    )


settings = Settings()
