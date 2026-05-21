from __future__ import annotations

import asyncio
import json
import logging

from redis.asyncio import Redis

from ..config import Settings
from .file_writer import append_audit_line
from .paths import resolve_daily_audit_path

logger = logging.getLogger("didit_proxy.audit.worker")


class AuditLogWorker:
    def __init__(self, redis_client: Redis, settings: Settings) -> None:
        self._redis = redis_client
        self._settings = settings
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run(), name="audit-log-worker")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task is None:
            return
        try:
            await asyncio.wait_for(self._task, timeout=self._settings.audit_worker_block_seconds + 2)
        except asyncio.TimeoutError:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        finally:
            self._task = None

    async def _run(self) -> None:
        queue_key = self._settings.audit_redis_queue_key
        block_seconds = self._settings.audit_worker_block_seconds
        while not self._stop_event.is_set():
            try:
                item = await self._redis.blpop(queue_key, timeout=block_seconds)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Audit worker BLPOP failed: %s", exc)
                await asyncio.sleep(1)
                continue

            if item is None:
                continue

            _, raw = item
            await asyncio.to_thread(self._process_message, raw)

    def _process_message(self, raw: str) -> None:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Audit worker dropped invalid JSON: %r", raw[:200])
            return
        if not isinstance(payload, dict):
            logger.warning("Audit worker dropped non-object payload")
            return

        line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        path = resolve_daily_audit_path(
            self._settings.audit_log_dir,
            self._settings.audit_log_timezone,
        )
        try:
            append_audit_line(path, line)
        except Exception as exc:
            logger.exception("Audit worker failed to write %s: %s", path, exc)
