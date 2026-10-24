from urllib.parse import quote

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


class PostgresConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str
    echo: bool = False
    echo_pool: bool = False
    pool_size: int = 50
    max_overflow: int = 10
    naming_conventions: dict[str, str] = {
        "ix": "ix_%(column_0_label)s",
        "uq": "uq_%(table_name)s_%(column_0_name)s",
        "ck": "ck_%(table_name)s_%(constraint_name)s",
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        "pk": "pk_%(table_name)s",
    }

    @property
    def url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.user}:"
            f"{self.password}@{self.host}:"
            f"{self.port}/{self.database}"
        )


class JWTConfig(BaseModel):
    secret: str
    algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15


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


class AppConfig(BaseModel):
    frontend_url: str
    desktop_origins: list[str] = []
    refresh_token_ttl_days: int = 30
    refresh_token_max_age_days: int = 365
    email_token_ttl_hours: int = 24
    password_reset_token_ttl_minutes: int = 60
    cookie_secure: bool = True


class ReleasesConfig(BaseModel):
    """Хранилище инсталляторов десктопного приложения.

    `dir` монтируется томом и в web (пишем при публикации), и в
    nginx фронта (раздаём статикой). FastAPI сам байты не отдаёт —
    гонять 60 МБ через uvicorn незачем.
    """

    dir: str = "/releases"
    # Публичный префикс, под которым nginx отдаёт содержимое `dir`.
    # Пустая строка = собрать из frontend_url.
    public_base_url: str = ""
    max_upload_mb: int = 512


class SupportConfig(BaseModel):
    """Support inbox. `dir` is the watchdemo_support_data volume, mounted only in web:
    images are served by FastAPI after an access check, never by nginx."""

    dir: str = "/support"
    # Decision 6a: a resolved ticket closes 72 h after resolved_at, an idle pending one
    # resolves after 7 days.
    resolved_close_hours: int = 72
    pending_resolve_days: int = 7
    periodic_interval_seconds: int = 300


class RedisConfig(BaseModel):
    host: str = "redis"
    port: int = 6379
    db: int = 0

    @property
    def url(self) -> str:
        return f"redis://{self.host}:{self.port}/{self.db}"


class Settings(BaseSettings):
    postgres: PostgresConfig
    jwt: JWTConfig
    rabbitmq: RabbitMQConfig
    resend: ResendConfig
    app: AppConfig
    redis: RedisConfig = RedisConfig()
    releases: ReleasesConfig = ReleasesConfig()
    support: SupportConfig = SupportConfig()
    # Top-level names on purpose: `.env` already has TELEGRAM_BOT_TOKEN. No token, no bot.
    telegram_bot_token: str = ""
    telegram_webhook_secret: str = ""

    model_config = SettingsConfigDict(
        case_sensitive=False,
        env_nested_delimiter="__",
        env_file=[".env", "../.env"],
    )


settings = Settings()
