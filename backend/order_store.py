from __future__ import annotations

import threading
import time
from copy import deepcopy
from typing import Any


class InMemoryOrderStore:
    def __init__(self, ttl_ms: int) -> None:
        self._ttl_ms = max(60_000, ttl_ms)
        self._lock = threading.RLock()
        self._records: dict[str, dict[str, Any]] = {}

    def _now_ms(self) -> int:
        return int(time.time() * 1000)

    def _purge_locked(self, now_ms: int) -> None:
        expired = [order_id for order_id, record in self._records.items() if int(record.get("expires_at", 0)) <= now_ms]
        for order_id in expired:
            self._records.pop(order_id, None)

    def _extend_ttl_locked(self, record: dict[str, Any], now_ms: int) -> None:
        record["expires_at"] = now_ms + self._ttl_ms

    def _touch_locked(self, record: dict[str, Any], now_ms: int) -> None:
        self._extend_ttl_locked(record, now_ms)
        record["last_updated_at"] = now_ms

    def save_order(self, order: dict[str, Any], create_summary: dict[str, Any] | None = None) -> dict[str, Any]:
        order_id = str(order.get("id", "")).strip()
        if not order_id:
            raise ValueError("order id is required")
        now_ms = self._now_ms()
        with self._lock:
            self._purge_locked(now_ms)
            existing = self._records.get(order_id)
            record = {
                "order_id": order_id,
                "order": deepcopy(order),
                "create_summary": (
                    deepcopy(create_summary)
                    if create_summary is not None
                    else deepcopy(existing.get("create_summary")) if existing else None
                ),
                "created_at": existing.get("created_at", now_ms) if existing else now_ms,
                "expires_at": now_ms + self._ttl_ms,
                "updates": deepcopy(existing.get("updates", [])) if existing else [],
                "last_updated_at": now_ms,
            }
            self._records[order_id] = record
            return deepcopy(record)

    def add_update(self, update: dict[str, Any]) -> dict[str, Any] | None:
        order_info = update.get("order_info")
        if not isinstance(order_info, dict):
            return None
        order_id = str(order_info.get("order_id", "")).strip()
        if not order_id:
            return None
        now_ms = self._now_ms()
        normalized_update = deepcopy(update)
        normalized_update["received_at"] = now_ms
        with self._lock:
            self._purge_locked(now_ms)
            record = self._records.get(order_id)
            if record is None:
                record = {
                    "order_id": order_id,
                    "order": None,
                    "created_at": now_ms,
                    "expires_at": now_ms + self._ttl_ms,
                    "updates": [],
                    "last_updated_at": now_ms,
                }
                self._records[order_id] = record
            record["updates"].append(normalized_update)
            self._touch_locked(record, now_ms)
            return deepcopy(record)

    def get_record(self, order_id: str, *, touch_ttl: bool = False) -> dict[str, Any] | None:
        now_ms = self._now_ms()
        with self._lock:
            self._purge_locked(now_ms)
            record = self._records.get(order_id)
            if record is None:
                return None
            if touch_ttl:
                self._extend_ttl_locked(record, now_ms)
            return deepcopy(record)

    def remove_expired(self) -> None:
        now_ms = self._now_ms()
        with self._lock:
            self._purge_locked(now_ms)
