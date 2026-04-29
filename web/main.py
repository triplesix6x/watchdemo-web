from contextlib import asynccontextmanager

from fastapi import FastAPI

from API import router as api_router
from APP.exception_handlers import register_exception_handlers
from APP.middlewares import RequestLoggingMiddleware
from SPI.mq_adapter.publisher import MQPublisher


@asynccontextmanager
async def lifespan(app: FastAPI):
    publisher = MQPublisher()
    await publisher.connect()
    app.state.publisher = publisher
    yield
    await publisher.close()


app = FastAPI(lifespan=lifespan)

app.add_middleware(RequestLoggingMiddleware)
app.include_router(api_router)
register_exception_handlers(app)
