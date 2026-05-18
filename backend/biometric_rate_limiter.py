from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any


@dataclass(slots=True)
class BiometricRateLimitDecision:
    allowed: bool
    limit: int
    used: int
    remaining: int
    day: str


class FileBiometricRateLimiter:
    def __init__(self, file_path: Path, daily_limit: int = 3) -> None:
        self.file_path = file_path
        self.daily_limit = max(1, daily_limit)
        self._lock = Lock()

    def consume(self, client_ip: str) -> BiometricRateLimitDecision:
        day = datetime.now().astimezone().date().isoformat()
        client_key = self._client_key(client_ip)

        with self._lock:
            payload = self._read_payload()
            raw_day_counts = payload.get(day)
            day_counts = raw_day_counts if isinstance(raw_day_counts, dict) else {}
            used = self._as_non_negative_int(day_counts.get(client_key))

            if used >= self.daily_limit:
                return BiometricRateLimitDecision(
                    allowed=False,
                    limit=self.daily_limit,
                    used=used,
                    remaining=0,
                    day=day,
                )

            used += 1
            day_counts[client_key] = used
            self._write_payload({day: day_counts})

        return BiometricRateLimitDecision(
            allowed=True,
            limit=self.daily_limit,
            used=used,
            remaining=self.daily_limit - used,
            day=day,
        )

    @staticmethod
    def _client_key(client_ip: str) -> str:
        normalized = client_ip.strip() or "unknown"
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    @staticmethod
    def _as_non_negative_int(value: Any) -> int:
        if isinstance(value, bool):
            return 0
        if isinstance(value, int):
            return max(0, value)
        if isinstance(value, str) and value.strip().isdigit():
            return max(0, int(value.strip()))
        return 0

    def _read_payload(self) -> dict[str, Any]:
        if not self.file_path.exists():
            return {}
        try:
            raw = json.loads(self.file_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
        return raw if isinstance(raw, dict) else {}

    def _write_payload(self, payload: dict[str, Any]) -> None:
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.file_path.with_suffix(f"{self.file_path.suffix}.tmp")
        temp_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True), encoding="utf-8")
        temp_path.replace(self.file_path)
