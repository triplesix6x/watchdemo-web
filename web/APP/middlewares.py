from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from APP.logger import AppLogger

logger = AppLogger.get_logger()


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        logger.info(
            f"[request] {request.method} {request.url.path} "
            f"ip={request.client.host if request.client else 'unknown'}"
        )
        response = await call_next(request)
        logger.info(
            f"[response] {request.method} {request.url.path} "
            f"status={response.status_code}"
        )
        return response
