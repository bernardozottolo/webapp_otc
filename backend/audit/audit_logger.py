from __future__ import annotations

import asyncio
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Request

from ..request_context import get_request_id
from ..security.client_ip import get_client_ip
from .sanitizers import sanitize_audit_data


class AuditLogger:
    def __init__(
        self,
        *,
        enabled: bool,
        path: Path,
        max_bytes: int,
        backup_count: int,
    ) -> None:
        self.enabled = enabled
        self.path = path
        self.max_bytes = max(1024, max_bytes)
        self.backup_count = max(1, backup_count)
        self._lock = threading.RLock()

    async def write_audit_event(self, request: Request, event: str, data: dict[str, Any] | None = None) -> None:
        if not self.enabled:
            return
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "event": event,
            "request_id": getattr(request.state, "request_id", None) or get_request_id(),
            "ip": get_client_ip(request),
            "user_agent": request.headers.get("user-agent", ""),
            "method": request.method,
            "path": request.url.path,
            "data": sanitize_audit_data(data),
        }
        await asyncio.to_thread(self._write_line_sync, payload)

    def _rotate_if_needed(self) -> None:
        if not self.path.exists():
            return
        if self.path.stat().st_size < self.max_bytes:
            return

        oldest = self.path.with_name(f"{self.path.name}.{self.backup_count}")
        if oldest.exists():
            oldest.unlink()

        for idx in range(self.backup_count - 1, 0, -1):
            current = self.path.with_name(f"{self.path.name}.{idx}")
            nxt = self.path.with_name(f"{self.path.name}.{idx + 1}")
            if current.exists():
                current.replace(nxt)

        self.path.replace(self.path.with_name(f"{self.path.name}.1"))

    def _write_line_sync(self, payload: dict[str, Any]) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._rotate_if_needed()
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
                handle.write("\n")


def get_audit_logger(request: Request) -> AuditLogger:
    logger = getattr(request.app.state, "audit_logger", None)
    if logger is None:
        return AuditLogger(enabled=False, path=Path("audit.log.jsonl"), max_bytes=1024, backup_count=1)
    return logger  # type: ignore[no-any-return]


async def write_audit_event(request: Request, event: str, data: dict[str, Any] | None = None) -> None:
    logger = get_audit_logger(request)
    await logger.write_audit_event(request, event, data)
