from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from redis.asyncio import Redis

logger = logging.getLogger("didit_proxy.security.blacklist")


class IpBlacklistService:
    def __init__(self, redis_client: Redis | None, *, enabled: bool) -> None:
        self.redis = redis_client
        self.enabled = enabled

    @property
    def available(self) -> bool:
        return self.enabled and self.redis is not None

    @staticmethod
    def _key(ip: str) -> str:
        return f"security:blacklist:{ip}"

    async def add_ip_to_blacklist(self, ip: str, reason: str, ttl_seconds: int | None = None, *, source: str = "manual") -> None:
        if not self.available or not ip:
            return
        now = datetime.now(timezone.utc)
        payload = {
            "ip": ip,
            "reason": reason,
            "source": source,
            "created_at": now.isoformat().replace("+00:00", "Z"),
            "expires_at": (
                (now + timedelta(seconds=ttl_seconds)).isoformat().replace("+00:00", "Z")
                if ttl_seconds and ttl_seconds > 0
                else None
            ),
        }
        try:
            if ttl_seconds and ttl_seconds > 0:
                await self.redis.set(self._key(ip), json.dumps(payload, ensure_ascii=False), ex=ttl_seconds)
            else:
                await self.redis.set(self._key(ip), json.dumps(payload, ensure_ascii=False))
        except Exception as exc:
            logger.warning("Falha ao adicionar IP %s na blacklist: %s", ip, exc)

    async def remove_ip_from_blacklist(self, ip: str) -> None:
        if not self.available or not ip:
            return
        try:
            await self.redis.delete(self._key(ip))
        except Exception as exc:
            logger.warning("Falha ao remover IP %s da blacklist: %s", ip, exc)

    async def get_blacklist_entry(self, ip: str) -> dict[str, Any] | None:
        if not self.available or not ip:
            return None
        try:
            raw = await self.redis.get(self._key(ip))
        except Exception as exc:
            logger.warning("Falha ao consultar blacklist para IP %s: %s", ip, exc)
            return None
        if not raw:
            return None
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return {"ip": ip, "reason": "unknown", "source": "unknown"}
        return value if isinstance(value, dict) else {"ip": ip}

    async def is_ip_blacklisted(self, ip: str) -> bool:
        return await self.get_blacklist_entry(ip) is not None

    async def list_blacklisted_ips(self) -> list[dict[str, Any]]:
        if not self.available:
            return []
        results: list[dict[str, Any]] = []
        try:
            async for key in self.redis.scan_iter(match="security:blacklist:*"):
                raw = await self.redis.get(key)
                if not raw:
                    continue
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    ip = str(key).split(":")[-1]
                    payload = {"ip": ip, "reason": "unknown", "source": "unknown"}
                if isinstance(payload, dict):
                    results.append(payload)
        except Exception as exc:
            logger.warning("Falha ao listar IPs em blacklist: %s", exc)
            return []
        results.sort(key=lambda item: str(item.get("created_at", "")), reverse=True)
        return results
