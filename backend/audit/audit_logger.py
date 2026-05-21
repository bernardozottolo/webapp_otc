from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import Request
from redis.asyncio import Redis

from ..config import Settings
from ..request_context import get_request_id
from ..security.client_ip import get_client_ip
from .file_writer import append_audit_line
from .paths import local_date_string, resolve_daily_audit_path
from .sanitizers import sanitize_audit_data

logger = logging.getLogger("didit_proxy.audit")


class AuditLogger:
    def __init__(
        self,
        *,
        enabled: bool,
        settings: Settings,
        redis_client: Redis | None = None,
    ) -> None:
        self.enabled = enabled
        self.settings = settings
        self.redis = redis_client

    def _build_payload(self, request: Request, event: str, data: dict[str, Any] | None) -> dict[str, Any]:
        now_utc = datetime.now(timezone.utc)
        return {
            "timestamp": now_utc.isoformat().replace("+00:00", "Z"),
            "local_date": local_date_string(self.settings.audit_log_timezone, at=now_utc),
            "event": event,
            "request_id": getattr(request.state, "request_id", None) or get_request_id(),
            "ip": get_client_ip(request),
            "user_agent": request.headers.get("user-agent", ""),
            "method": request.method,
            "path": request.url.path,
            "data": sanitize_audit_data(data),
        }

    def _serialize_payload(self, payload: dict[str, Any]) -> str:
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    def _write_sync_fallback(self, payload: dict[str, Any]) -> None:
        line = self._serialize_payload(payload)
        path = resolve_daily_audit_path(
            self.settings.audit_log_dir,
            self.settings.audit_log_timezone,
        )
        append_audit_line(path, line)

    async def write_audit_event(self, request: Request, event: str, data: dict[str, Any] | None = None) -> None:
        if not self.enabled:
            return

        payload = self._build_payload(request, event, data)
        serialized = self._serialize_payload(payload)

        if self.redis is not None:
            try:
                await self.redis.rpush(self.settings.audit_redis_queue_key, serialized)
                return
            except Exception as exc:
                logger.warning("Audit RPUSH failed, falling back to sync file write: %s", exc)

        await asyncio.to_thread(self._write_sync_fallback, payload)


def get_audit_logger(request: Request) -> AuditLogger:
    audit_logger = getattr(request.app.state, "audit_logger", None)
    if audit_logger is None:
        from ..config import get_settings

        return AuditLogger(enabled=False, settings=get_settings(), redis_client=None)
    return audit_logger  # type: ignore[no-any-return]


async def write_audit_event(request: Request, event: str, data: dict[str, Any] | None = None) -> None:
    audit_logger = get_audit_logger(request)
    await audit_logger.write_audit_event(request, event, data)
