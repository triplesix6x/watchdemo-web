from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from API import router as api_router
from APP.config import settings
from APP.exception_handlers import register_exception_handlers
from APP.middlewares import RequestLoggingMiddleware, SecurityHeadersMiddleware
from SPI.mq_adapter.publisher import MQPublisher
from SPI.db_adapter.models.user import UserModel
from SPI.db_adapter.models.subscription import SubscriptionModel
from SPI.db_adapter.models.session import SessionModel
from SPI.db_adapter.models.token import OneTimeTokenModel
from SPI.db_adapter.models.audit_log import AuditLogModel


@asynccontextmanager
async def lifespan(app: FastAPI):
    publisher = MQPublisher()
    await publisher.connect()
    app.state.publisher = publisher

    redis = Redis.from_url(settings.redis.url, decode_responses=True)
    app.state.redis = redis

    yield

    await publisher.close()
    await redis.aclose()


app = FastAPI(lifespan=lifespan)

app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
_allowed_origins = [settings.app.frontend_url.rstrip("/")] + settings.app.desktop_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])
app.include_router(api_router)
register_exception_handlers(app)
