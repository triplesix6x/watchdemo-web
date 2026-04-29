from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from APP.exceptions import (
    NotFoundError,
    AlreadyExistsError,
    InvalidCredentialsError,
    EmailNotVerifiedError,
    TokenExpiredError,
    InvalidTokenError,
    PermissionDeniedError,
    PasswordValidationError,
)
from APP.logger import AppLogger

logger = AppLogger.get_logger()


def _body(message: str) -> dict:
    return {"message": message}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(NotFoundError)
    async def _(_r: Request, exc: NotFoundError):
        return JSONResponse(status_code=404, content=_body(exc.message))

    @app.exception_handler(AlreadyExistsError)
    async def _(_r: Request, exc: AlreadyExistsError):
        return JSONResponse(status_code=409, content=_body(exc.message))

    @app.exception_handler(InvalidCredentialsError)
    async def _(_r: Request, exc: InvalidCredentialsError):
        return JSONResponse(status_code=401, content=_body(exc.message))

    @app.exception_handler(EmailNotVerifiedError)
    async def _(_r: Request, exc: EmailNotVerifiedError):
        return JSONResponse(status_code=403, content=_body(exc.message))

    @app.exception_handler(TokenExpiredError)
    async def _(_r: Request, exc: TokenExpiredError):
        return JSONResponse(status_code=401, content=_body(exc.message))

    @app.exception_handler(InvalidTokenError)
    async def _(_r: Request, exc: InvalidTokenError):
        return JSONResponse(status_code=401, content=_body(exc.message))

    @app.exception_handler(PermissionDeniedError)
    async def _(_r: Request, exc: PermissionDeniedError):
        return JSONResponse(status_code=403, content=_body(exc.message))

    @app.exception_handler(PasswordValidationError)
    async def _(_r: Request, exc: PasswordValidationError):
        return JSONResponse(status_code=422, content=_body(exc.message))

    @app.exception_handler(Exception)
    async def _(_r: Request, exc: Exception):
        logger.exception(f"Unhandled exception: {exc}")
        return JSONResponse(status_code=500, content=_body("Internal server error"))
