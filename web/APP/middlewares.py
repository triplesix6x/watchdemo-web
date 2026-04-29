from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from APP.logger import AppLogger

logger = AppLogger.get_logger()

# Пути, которые не требуют проверки наличия токена
_TOKEN_EXCLUDED_PATHS = {
}


class TokenCheckMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        if path not in _TOKEN_EXCLUDED_PATHS and not request.headers.get("token"):
            logger.warning(
                f"[middleware] missing token path={path} "
                f"ip={request.client.host if request.client else 'unknown'}"
            )
            return JSONResponse(
                status_code=401,
                content={"detail": "Token header is required"},
            )

        return await call_next(request)
