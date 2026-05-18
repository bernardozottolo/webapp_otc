"""Utilitários para logs de HTTP (truncar, redigir segredos e PII operacional)."""

from __future__ import annotations

import re
from typing import Final
from urllib.parse import parse_qsl, urlencode

_MAX_CHARS_DEFAULT: Final[int] = 8192
_REDACTED: Final[str] = "[REDACTED]"
_SENSITIVE_KEYS: Final[tuple[str, ...]] = (
    "password",
    "authorization",
    "token",
    "api_key",
    "apikey",
    "x_api_key",
    "x_api-key",
    "secret",
    "client_secret",
    "refresh_token",
    "email",
    "document",
    "document_number",
    "birth_date",
    "date_of_birth",
    "name",
    "full_name",
    "first_name",
    "last_name",
    "portrait_image",
    "payload",
    "qr_code",
    "wallet",
    "wallet_address",
    "tax_id",
    "beneficiarytaxid",
    "vendor_data",
    "session_id",
    "order_id",
)

_JSON_KEY_RE = re.compile(
    r'"(?P<key>[^"]+)"\s*:\s*"(?P<value>[^"]*)"',
    re.IGNORECASE,
)
_HEADER_BEARER_RE = re.compile(
    r"(?i)\b(authorization|x-api-key|api-key)\b\s*[:=]\s*([^\s,\n]+)"
)


def _normalize_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.lower())


def is_sensitive_key(key: str) -> bool:
    normalized = _normalize_key(key)
    return any(normalized == _normalize_key(candidate) for candidate in _SENSITIVE_KEYS)


def redact_jsonish_text(s: str) -> str:
    def replace_json(match: re.Match[str]) -> str:
        key = match.group("key")
        value = match.group("value")
        if is_sensitive_key(key):
            return f'"{key}":"{_REDACTED}"'
        return f'"{key}":"{value}"'

    redacted = _JSON_KEY_RE.sub(replace_json, s)
    return _HEADER_BEARER_RE.sub(lambda m: f"{m.group(1)}: {_REDACTED}", redacted)


def redact_query_string(qs: str) -> str:
    if not qs:
        return ""
    pairs = parse_qsl(qs, keep_blank_values=True)
    sanitized = [
        (key, _REDACTED if is_sensitive_key(key) else value)
        for key, value in pairs
    ]
    return urlencode(sanitized, doseq=True)


def truncate_text(s: str, max_chars: int = _MAX_CHARS_DEFAULT) -> str:
    if len(s) <= max_chars:
        return s
    return s[: max_chars - 28] + "... [truncado]"


def decode_body_preview(raw: bytes | None, *, max_chars: int = _MAX_CHARS_DEFAULT) -> str:
    if not raw:
        return ""
    text = raw.decode("utf-8", errors="replace")
    return truncate_text(redact_jsonish_text(text), max_chars)
