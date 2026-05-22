from __future__ import annotations

import json
import re
from copy import deepcopy
from typing import Any

_DROP_KEY_PARTS = (
    "base64",
    "blob",
    "binary",
    "raw_file",
)
_DROP_KEYS = frozenset(
    {
        "imagemqrcodeinbase64",
        "qr_code_base64",
        "qrcodebase64",
        "qr_code_image",
        "image_base64",
        "portrait_image",
        "portraitimage",
        "front_image",
    }
)


def _normalize_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.lower())


def _should_drop_key(key: str, *, allow_qr_on_create: bool) -> bool:
    if allow_qr_on_create:
        return False
    normalized = _normalize_key(key)
    if normalized in _DROP_KEYS:
        return True
    return any(part in normalized for part in _DROP_KEY_PARTS)


def _summarize_large_string(value: str, max_len: int = 256) -> str:
    compact = value.strip()
    if len(compact) <= max_len:
        return compact
    return f"[omitted {len(compact)} chars]"


def sanitize_notification_payload(
    value: Any,
    *,
    allow_qr_on_create: bool = False,
    key: str | None = None,
) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for raw_key, raw_value in value.items():
            child_key = str(raw_key)
            if _should_drop_key(child_key, allow_qr_on_create=allow_qr_on_create):
                sanitized[child_key] = "[omitted]"
                continue
            sanitized[child_key] = sanitize_notification_payload(
                raw_value,
                allow_qr_on_create=allow_qr_on_create,
                key=child_key,
            )
        return sanitized

    if isinstance(value, list):
        return [
            sanitize_notification_payload(item, allow_qr_on_create=allow_qr_on_create)
            for item in value[:100]
        ]

    if isinstance(value, str) and not allow_qr_on_create:
        if key and _should_drop_key(key, allow_qr_on_create=False):
            return "[omitted]"
        if _normalize_key(key or "") in _DROP_KEYS or _looks_like_large_base64(value):
            return _summarize_large_string(value)
    return value


def _looks_like_large_base64(value: str) -> bool:
    compact = value.strip()
    if len(compact) < 512:
        return False
    if compact.startswith("data:"):
        return True
    return bool(re.fullmatch(r"[A-Za-z0-9+/=\s_-]+", compact))


def truncate_envelope(envelope: dict[str, Any], max_chars: int) -> dict[str, Any]:
    serialized = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))
    if len(serialized) <= max_chars:
        return envelope

    truncated = deepcopy(envelope)
    truncated["truncated"] = True
    truncated["max_chars"] = max_chars
    payload = truncated.get("payload")
    if isinstance(payload, dict):
        payload["truncated_note"] = "payload reduced to fit ORDER_NOTIFICATION_MAX_BODY_CHARS"
    while len(json.dumps(truncated, ensure_ascii=False, separators=(",", ":"))) > max_chars:
        payload_obj = truncated.get("payload")
        if not isinstance(payload_obj, dict) or not payload_obj:
            break
        largest_key = max(payload_obj.keys(), key=lambda k: len(json.dumps(payload_obj[k], default=str)))
        payload_obj[largest_key] = "[truncated]"
    return truncated
