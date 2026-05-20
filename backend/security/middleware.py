from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from ..audit.audit_logger import write_audit_event
from .client_ip import get_client_ip
from .ip_blacklist import IpBlacklistService
from .rate_limiter import RedisRateLimiter


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        if request.scope.get("type") != "http":
            return await call_next(request)

        path = request.url.path
        if not RedisRateLimiter.should_protect_path(path):
            return await call_next(request)

        client_ip = get_client_ip(request)
        blacklist_service: IpBlacklistService | None = getattr(request.app.state, "ip_blacklist_service", None)
        rate_limiter: RedisRateLimiter | None = getattr(request.app.state, "rate_limiter", None)

        if blacklist_service is not None and blacklist_service.available:
            entry = await blacklist_service.get_blacklist_entry(client_ip)
            if entry is not None:
                await write_audit_event(
                    request,
                    "ip_blocked_request",
                    {
                        "ip": client_ip,
                        "reason": entry.get("reason"),
                        "source": entry.get("source"),
                    },
                )
                return JSONResponse(status_code=403, content={"detail": "IP blocked"})

        if rate_limiter is not None and rate_limiter.available and not RedisRateLimiter.should_skip_rate_limit(request):
            decision = await rate_limiter.check_request(request, client_ip=client_ip)
            if not decision.allowed:
                await rate_limiter.register_abuse(client_ip, route_key=decision.rule_key)
                await write_audit_event(
                    request,
                    "rate_limit_exceeded",
                    {
                        "ip": client_ip,
                        "rule": decision.rule_key,
                        "count": decision.count,
                        "limit": decision.limit,
                        "window_seconds": decision.window_seconds,
                    },
                )
                return JSONResponse(status_code=429, content={"detail": "Too many requests"})

        return await call_next(request)
