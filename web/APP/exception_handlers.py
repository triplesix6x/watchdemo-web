from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from APP.exceptions import AppException, ErrorCode
from APP.logger import AppLogger

logger = AppLogger.get_logger()


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppException)
    async def _(_r: Request, exc: AppException):
        retry = exc.extra.get("retry_after_seconds")
        return JSONResponse(
            status_code=exc.status,
            content={"message": exc.message, "code": exc.code, **exc.extra},
            headers={"Retry-After": str(retry)} if retry is not None else None,
        )

    @app.exception_handler(RequestValidationError)
    async def _(_r: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={
                "message": "Validation failed",
                "code": ErrorCode.VALIDATION_FAILED,
                "detail": jsonable_encoder(exc.errors()),
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def _(_r: Request, exc: StarletteHTTPException):
        message = exc.detail if isinstance(exc.detail, str) else "HTTP error"
        return JSONResponse(
            status_code=exc.status_code,
            content={"message": message, "code": ErrorCode.HTTP_ERROR, "detail": exc.detail},
            headers=exc.headers,
        )

    @app.exception_handler(Exception)
    async def _(_r: Request, exc: Exception):
        logger.exception(f"Unhandled exception: {exc}")
        return JSONResponse(
            status_code=500,
            content={"message": "Internal server error", "code": ErrorCode.INTERNAL_ERROR},
        )
