from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from APP.logger import AppLogger

logger = AppLogger.get_logger()


def _error_body(message: str) -> dict:
    return {"message": message}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(Exception)
    async def _(_r: Request, exc: Exception):
        logger.exception(f"Unhandled exception: {exc}")
        return JSONResponse(status_code=500, content=_error_body(f"Unhandled exception: {exc}"))
