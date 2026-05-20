from __future__ import annotations

import re
from typing import Any

_REDACTED = "[REDACTED]"
_REMOVED = "[REMOVED]"
_TRUNCATED = "[TRUNCATED]"
_BASE64ISH_RE = re.compile(r"^[A-Za-z0-9+/=\s_-]+$")

_SECRET_KEYS = {
    "authorization",
    "api_key",
    "apikey",
    "x_api_key",
    "x_api-key",
    "token",
    "admin_security_token",
    "x_admin_security_token",
    "x-admin-security-token",
    "session_token",
    "verification_code",
    "otp",
    "otp_code",
}

_DROP_KEYS = {
    "imagemqrcodeinbase64",
    "qr_code_base64",
    "qrcodebase64",
    "qr_code_image",
    "qrcodeimage",
    "portrait_image",
    "portraitimage",
    "blob",
    "image_blob",
    "image_bytes",
}

_DROP_KEY_PARTS = (
    "base64",
    "blob",
    "binary",
)

_MAX_STRING_LEN = 2048
_MAX_COLLECTION_ITEMS = 100


def _normalize_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.lower())


def _looks_like_large_base64(value: str) -> bool:
    compact = value.strip()
    if len(compact) < 512:
        return False
    if compact.startswith("data:"):
        return True
    if not _BASE64ISH_RE.fullmatch(compact):
        return False
    return True


def _should_drop_key(key: str) -> bool:
    normalized = _normalize_key(key)
    if normalized in _DROP_KEYS:
        return True
    return any(part in normalized for part in _DROP_KEY_PARTS)


def _sanitize_string(value: str, key: str | None = None) -> str:
    if key and _normalize_key(key) in {_normalize_key(item) for item in _SECRET_KEYS}:
        return _REDACTED
    if key and _should_drop_key(key):
        return _REMOVED
    if _looks_like_large_base64(value):
        return _REMOVED
    if len(value) > _MAX_STRING_LEN:
        return value[: _MAX_STRING_LEN - len(_TRUNCATED) - 1] + " " + _TRUNCATED
    return value


def sanitize_audit_value(value: Any, *, key: str | None = None) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for raw_key, raw_value in value.items():
            child_key = str(raw_key)
            if _should_drop_key(child_key):
                continue
            sanitized[child_key] = sanitize_audit_value(raw_value, key=child_key)
        return sanitized

    if isinstance(value, list):
        items = [sanitize_audit_value(item, key=key) for item in value[:_MAX_COLLECTION_ITEMS]]
        if len(value) > _MAX_COLLECTION_ITEMS:
            items.append(_TRUNCATED)
        return items

    if isinstance(value, tuple):
        return sanitize_audit_value(list(value), key=key)

    if isinstance(value, str):
        return _sanitize_string(value, key=key)

    return value


def sanitize_audit_data(data: dict[str, Any] | None) -> dict[str, Any]:
    if not data:
        return {}
    return sanitize_audit_value(data) if isinstance(data, dict) else {"value": sanitize_audit_value(data)}
