from contextlib import asynccontextmanager

from fastapi import FastAPI

from API import router as api_router
from APP.middlewares import TokenCheckMiddleware
from APP.exception_handlers import register_exception_handlers


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(TokenCheckMiddleware)
app.include_router(api_router)
register_exception_handlers(app)
