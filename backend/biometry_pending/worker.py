from __future__ import annotations

import asyncio
import logging

from redis.asyncio import Redis

from ..clients_database_client import ClientsDatabaseUpstreamClient
from ..config import Settings
from ..didit_client import DiditClient
from .service import BiometryPendingService

logger = logging.getLogger("didit_proxy.biometry_pending.worker")


class BiometryPendingWorker:
    def __init__(
        self,
        redis_client: Redis,
        settings: Settings,
        didit_client: DiditClient,
        clients_db_client: ClientsDatabaseUpstreamClient | None,
    ) -> None:
        self._settings = settings
        self._redis = redis_client
        self._didit = didit_client
        self._clients_db = clients_db_client
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run(), name="biometry-pending-worker")
        logger.info(
            "Biometry pending worker started (interval=%ss, ttl=%sh)",
            self._settings.biometry_pending_poll_interval_seconds,
            self._settings.biometry_pending_ttl_hours,
        )

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task is None:
            return
        try:
            await asyncio.wait_for(self._task, timeout=self._settings.biometry_pending_poll_interval_seconds + 5)
        except asyncio.TimeoutError:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        finally:
            self._task = None
        logger.info("Biometry pending worker stopped")

    async def _run(self) -> None:
        interval = self._settings.biometry_pending_poll_interval_seconds
        while not self._stop_event.is_set():
            try:
                service = BiometryPendingService(
                    redis_client=self._redis,
                    settings=self._settings,
                    didit_client=self._didit,
                    clients_db_client=self._clients_db,
                )
                summary = await service.poll_all()
                if any(summary.values()):
                    logger.info("Biometry pending poll summary: %s", summary)
            except Exception as exc:
                logger.warning("Biometry pending worker cycle failed: %s", exc)

            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=interval)
            except asyncio.TimeoutError:
                continue
