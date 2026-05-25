from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Literal

from redis.asyncio import Redis

BiometryPendingAction = Literal["onboarding", "wallet_save"]

SESSION_KEY_PREFIX = "biometry:pending:session:"
INDEX_KEY = "biometry:pending:index"
DEDUP_ONBOARDING_PREFIX = "biometry:dedup:onboarding:"
DEDUP_WALLET_PREFIX = "biometry:dedup:wallet:"


@dataclass(slots=True)
class BiometryPendingRecord:
    session_id: str
    status: str
    action: BiometryPendingAction
    email: str
    asset: str | None
    company_key: str
    platform: str
    created_at_ms: int
    expires_at_ms: int
    last_polled_at_ms: int | None
    action_payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "status": self.status,
            "action": self.action,
            "email": self.email,
            "asset": self.asset,
            "company_key": self.company_key,
            "platform": self.platform,
            "created_at_ms": self.created_at_ms,
            "expires_at_ms": self.expires_at_ms,
            "last_polled_at_ms": self.last_polled_at_ms,
            "action_payload": self.action_payload,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> BiometryPendingRecord:
        action = raw.get("action")
        if action not in ("onboarding", "wallet_save"):
            raise ValueError("invalid action")
        return cls(
            session_id=str(raw["session_id"]),
            status=str(raw.get("status", "In Review")),
            action=action,
            email=str(raw["email"]).strip().lower(),
            asset=str(raw["asset"]).strip().upper() if raw.get("asset") else None,
            company_key=str(raw.get("company_key", "")),
            platform=str(raw.get("platform", "webapp")),
            created_at_ms=int(raw["created_at_ms"]),
            expires_at_ms=int(raw["expires_at_ms"]),
            last_polled_at_ms=int(raw["last_polled_at_ms"]) if raw.get("last_polled_at_ms") is not None else None,
            action_payload=dict(raw.get("action_payload") or {}),
        )


def _session_key(session_id: str) -> str:
    return f"{SESSION_KEY_PREFIX}{session_id}"


def _dedup_onboarding_key(email: str) -> str:
    return f"{DEDUP_ONBOARDING_PREFIX}{email.strip().lower()}"


def _dedup_wallet_key(email: str, asset: str) -> str:
    return f"{DEDUP_WALLET_PREFIX}{email.strip().lower()}:{asset.strip().upper()}"


def ttl_seconds_from_hours(hours: int) -> int:
    return max(3600, int(hours) * 3600)


class BiometryPendingStore:
    def __init__(self, redis_client: Redis, *, ttl_hours: int) -> None:
        self._redis = redis_client
        self._ttl_seconds = ttl_seconds_from_hours(ttl_hours)

    async def get_dedup_session_id(self, *, action: BiometryPendingAction, email: str, asset: str | None = None) -> str | None:
        if action == "onboarding":
            key = _dedup_onboarding_key(email)
        else:
            if not asset:
                return None
            key = _dedup_wallet_key(email, asset)
        value = await self._redis.get(key)
        return str(value) if value else None

    async def save(self, record: BiometryPendingRecord) -> None:
        payload = json.dumps(record.to_dict(), ensure_ascii=False)
        pipe = self._redis.pipeline()
        pipe.set(_session_key(record.session_id), payload, ex=self._ttl_seconds)
        pipe.sadd(INDEX_KEY, record.session_id)
        if record.action == "onboarding":
            pipe.set(_dedup_onboarding_key(record.email), record.session_id, ex=self._ttl_seconds)
        elif record.asset:
            pipe.set(_dedup_wallet_key(record.email, record.asset), record.session_id, ex=self._ttl_seconds)
        await pipe.execute()

    async def get(self, session_id: str) -> BiometryPendingRecord | None:
        raw = await self._redis.get(_session_key(session_id))
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if not isinstance(data, dict):
            return None
        return BiometryPendingRecord.from_dict(data)

    async def update_last_polled(self, session_id: str) -> None:
        record = await self.get(session_id)
        if record is None:
            return
        record.last_polled_at_ms = int(time.time() * 1000)
        await self._redis.set(
            _session_key(session_id),
            json.dumps(record.to_dict(), ensure_ascii=False),
            ex=self._ttl_seconds,
        )

    async def list_session_ids(self) -> list[str]:
        members = await self._redis.smembers(INDEX_KEY)
        return sorted(str(item) for item in members)

    async def remove(self, record: BiometryPendingRecord) -> None:
        pipe = self._redis.pipeline()
        pipe.delete(_session_key(record.session_id))
        pipe.srem(INDEX_KEY, record.session_id)
        if record.action == "onboarding":
            pipe.delete(_dedup_onboarding_key(record.email))
        elif record.asset:
            pipe.delete(_dedup_wallet_key(record.email, record.asset))
        await pipe.execute()
