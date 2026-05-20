from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import Request
from redis.asyncio import Redis

from ..config import Settings
from .ip_blacklist import IpBlacklistService

logger = logging.getLogger("didit_proxy.security.rate_limit")


@dataclass(frozen=True)
class RateLimitRule:
    key: str
    requests: int
    window_seconds: int


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    count: int
    limit: int
    window_seconds: int
    rule_key: str


class RedisRateLimiter:
    def __init__(
        self,
        redis_client: Redis | None,
        *,
        settings: Settings,
        blacklist_service: IpBlacklistService | None = None,
    ) -> None:
        self.redis = redis_client
        self.settings = settings
        self.blacklist_service = blacklist_service

    @property
    def available(self) -> bool:
        return self.settings.rate_limit_enabled and self.redis is not None

    @staticmethod
    def should_protect_path(path: str) -> bool:
        return (
            path.startswith("/webhook/")
            or path.startswith("/otc/")
            or path.startswith("/api/")
            or path.startswith("/admin/security/")
        )

    @staticmethod
    def should_skip_rate_limit(request: Request) -> bool:
        path = request.url.path
        return request.method.upper() == "GET" and path.startswith("/api/order-updates/")

    def rule_for_request(self, request: Request) -> RateLimitRule:
        path = request.url.path
        if path == "/webhook/clients_database/send-email":
            return RateLimitRule(
                "send_email",
                self.settings.rate_limit_send_email_requests,
                self.settings.rate_limit_send_email_window_seconds,
            )
        if path == "/webhook/clients_database/verify-otp":
            return RateLimitRule(
                "verify_otp",
                self.settings.rate_limit_verify_otp_requests,
                self.settings.rate_limit_verify_otp_window_seconds,
            )
        if path in {"/webhook/didit/session", "/webhook/didit/biometric-session-from-document"}:
            return RateLimitRule(
                "didit_session",
                self.settings.rate_limit_didit_session_requests,
                self.settings.rate_limit_didit_session_window_seconds,
            )
        if path == "/otc/create_order":
            return RateLimitRule(
                "create_order",
                self.settings.rate_limit_create_order_requests,
                self.settings.rate_limit_create_order_window_seconds,
            )
        if path == "/otc/get_pricing":
            return RateLimitRule(
                "get_pricing",
                self.settings.rate_limit_get_pricing_requests,
                self.settings.rate_limit_get_pricing_window_seconds,
            )
        return RateLimitRule(
            "default",
            self.settings.rate_limit_default_requests,
            self.settings.rate_limit_default_window_seconds,
        )

    async def consume_identifier(
        self,
        *,
        scope: str,
        identifier: str,
        requests: int,
        window_seconds: int,
    ) -> RateLimitDecision:
        if not self.available or not identifier:
            return RateLimitDecision(True, 0, requests, window_seconds, scope)
        key = f"security:rate_limit:{scope}:{identifier}"
        try:
            current = await self.redis.incr(key)
            if current == 1:
                await self.redis.expire(key, window_seconds)
        except Exception as exc:
            logger.warning("Falha ao consumir rate limit em %s: %s", scope, exc)
            return RateLimitDecision(True, 0, requests, window_seconds, scope)
        allowed = current <= requests
        return RateLimitDecision(allowed, int(current), requests, window_seconds, scope)

    async def check_request(self, request: Request, *, client_ip: str) -> RateLimitDecision:
        if not self.available or self.should_skip_rate_limit(request):
            return RateLimitDecision(True, 0, 0, 0, "skipped")
        rule = self.rule_for_request(request)
        return await self.consume_identifier(
            scope=f"{rule.key}:ip",
            identifier=client_ip,
            requests=rule.requests,
            window_seconds=rule.window_seconds,
        )

    async def register_abuse(self, client_ip: str, *, route_key: str) -> None:
        if not self.redis or not client_ip:
            return
        try:
            global_key = f"security:abuse:ip:{client_ip}"
            route_specific_key = f"security:abuse:route:{route_key}:{client_ip}"
            global_count = await self.redis.incr(global_key)
            if global_count == 1:
                await self.redis.expire(global_key, self.settings.ip_auto_block_window_seconds)
            route_count = await self.redis.incr(route_specific_key)
            if route_count == 1:
                await self.redis.expire(route_specific_key, self.settings.ip_auto_block_window_seconds)
            if (
                self.settings.ip_auto_block_enabled
                and self.blacklist_service is not None
                and global_count >= self.settings.ip_auto_block_threshold
            ):
                await self.blacklist_service.add_ip_to_blacklist(
                    client_ip,
                    reason=f"Auto-block after repeated rate limit violations on {route_key}",
                    ttl_seconds=self.settings.ip_auto_block_ttl_seconds,
                    source="auto_rate_limit",
                )
        except Exception as exc:
            logger.warning("Falha ao registrar abuso para IP %s: %s", client_ip, exc)
