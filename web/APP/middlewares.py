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


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        return response
