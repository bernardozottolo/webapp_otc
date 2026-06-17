from __future__ import annotations

import json
import threading
import time
from copy import deepcopy
from typing import Any, Protocol

from redis.asyncio import Redis


class OrderStore(Protocol):
    async def save_order(self, order: dict[str, Any], create_summary: dict[str, Any] | None = None) -> dict[str, Any]: ...

    async def add_update(self, update: dict[str, Any]) -> dict[str, Any] | None: ...

    async def get_record(self, order_id: str, *, touch_ttl: bool = False) -> dict[str, Any] | None: ...

    async def remove_expired(self) -> None: ...


def _now_ms() -> int:
    return int(time.time() * 1000)


def _build_saved_order_record(
    order_id: str,
    order: dict[str, Any],
    *,
    existing: dict[str, Any] | None,
    create_summary: dict[str, Any] | None,
    now_ms: int,
    ttl_ms: int,
) -> dict[str, Any]:
    return {
        "order_id": order_id,
        "order": deepcopy(order),
        "create_summary": (
            deepcopy(create_summary)
            if create_summary is not None
            else deepcopy(existing.get("create_summary")) if existing else None
        ),
        "created_at": existing.get("created_at", now_ms) if existing else now_ms,
        "expires_at": now_ms + ttl_ms,
        "updates": deepcopy(existing.get("updates", [])) if existing else [],
        "last_updated_at": now_ms,
    }


def _build_updated_record(
    order_id: str,
    normalized_update: dict[str, Any],
    *,
    existing: dict[str, Any] | None,
    now_ms: int,
    ttl_ms: int,
) -> dict[str, Any]:
    if existing is None:
        return {
            "order_id": order_id,
            "order": None,
            "create_summary": None,
            "created_at": now_ms,
            "expires_at": now_ms + ttl_ms,
            "updates": [deepcopy(normalized_update)],
            "last_updated_at": now_ms,
        }
    record = deepcopy(existing)
    record["updates"] = [*deepcopy(existing.get("updates", [])), deepcopy(normalized_update)]
    record["expires_at"] = now_ms + ttl_ms
    record["last_updated_at"] = now_ms
    return record


class InMemoryOrderStore:
    def __init__(self, ttl_ms: int) -> None:
        self._ttl_ms = max(60_000, ttl_ms)
        self._lock = threading.RLock()
        self._records: dict[str, dict[str, Any]] = {}

    def _purge_locked(self, now_ms: int) -> None:
        expired = [order_id for order_id, record in self._records.items() if int(record.get("expires_at", 0)) <= now_ms]
        for order_id in expired:
            self._records.pop(order_id, None)

    async def save_order(self, order: dict[str, Any], create_summary: dict[str, Any] | None = None) -> dict[str, Any]:
        order_id = str(order.get("id", "")).strip()
        if not order_id:
            raise ValueError("order id is required")
        now_ms = _now_ms()
        with self._lock:
            self._purge_locked(now_ms)
            existing = self._records.get(order_id)
            record = _build_saved_order_record(
                order_id,
                order,
                existing=existing,
                create_summary=create_summary,
                now_ms=now_ms,
                ttl_ms=self._ttl_ms,
            )
            self._records[order_id] = record
            return deepcopy(record)

    async def add_update(self, update: dict[str, Any]) -> dict[str, Any] | None:
        order_info = update.get("order_info")
        if not isinstance(order_info, dict):
            return None
        order_id = str(order_info.get("order_id", "")).strip()
        if not order_id:
            return None
        now_ms = _now_ms()
        normalized_update = deepcopy(update)
        normalized_update["received_at"] = now_ms
        with self._lock:
            self._purge_locked(now_ms)
            existing = self._records.get(order_id)
            record = _build_updated_record(
                order_id,
                normalized_update,
                existing=existing,
                now_ms=now_ms,
                ttl_ms=self._ttl_ms,
            )
            self._records[order_id] = record
            return deepcopy(record)

    async def get_record(self, order_id: str, *, touch_ttl: bool = False) -> dict[str, Any] | None:
        now_ms = _now_ms()
        with self._lock:
            self._purge_locked(now_ms)
            record = self._records.get(order_id)
            if record is None:
                return None
            if touch_ttl:
                record["expires_at"] = now_ms + self._ttl_ms
            return deepcopy(record)

    async def remove_expired(self) -> None:
        now_ms = _now_ms()
        with self._lock:
            self._purge_locked(now_ms)


class RedisOrderStore:
    def __init__(self, redis_client: Redis, ttl_ms: int, *, key_prefix: str = "order_store") -> None:
        self._redis = redis_client
        self._ttl_ms = max(60_000, ttl_ms)
        self._key_prefix = key_prefix.strip() or "order_store"

    def _key(self, order_id: str) -> str:
        return f"{self._key_prefix}:{order_id}"

    async def _read_record(self, order_id: str) -> dict[str, Any] | None:
        raw = await self._redis.get(self._key(order_id))
        if not raw:
            return None
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None

    async def _write_record(self, order_id: str, record: dict[str, Any], *, now_ms: int) -> dict[str, Any]:
        ttl_ms = max(1, int(record.get("expires_at", now_ms + self._ttl_ms)) - now_ms)
        await self._redis.set(self._key(order_id), json.dumps(record), px=ttl_ms)
        return deepcopy(record)

    async def save_order(self, order: dict[str, Any], create_summary: dict[str, Any] | None = None) -> dict[str, Any]:
        order_id = str(order.get("id", "")).strip()
        if not order_id:
            raise ValueError("order id is required")
        now_ms = _now_ms()
        existing = await self._read_record(order_id)
        record = _build_saved_order_record(
            order_id,
            order,
            existing=existing,
            create_summary=create_summary,
            now_ms=now_ms,
            ttl_ms=self._ttl_ms,
        )
        return await self._write_record(order_id, record, now_ms=now_ms)

    async def add_update(self, update: dict[str, Any]) -> dict[str, Any] | None:
        order_info = update.get("order_info")
        if not isinstance(order_info, dict):
            return None
        order_id = str(order_info.get("order_id", "")).strip()
        if not order_id:
            return None
        now_ms = _now_ms()
        normalized_update = deepcopy(update)
        normalized_update["received_at"] = now_ms
        existing = await self._read_record(order_id)
        record = _build_updated_record(
            order_id,
            normalized_update,
            existing=existing,
            now_ms=now_ms,
            ttl_ms=self._ttl_ms,
        )
        return await self._write_record(order_id, record, now_ms=now_ms)

    async def get_record(self, order_id: str, *, touch_ttl: bool = False) -> dict[str, Any] | None:
        now_ms = _now_ms()
        record = await self._read_record(order_id)
        if record is None:
            return None
        if touch_ttl:
            record["expires_at"] = now_ms + self._ttl_ms
            return await self._write_record(order_id, record, now_ms=now_ms)
        return deepcopy(record)

    async def remove_expired(self) -> None:
        return None
