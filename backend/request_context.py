from __future__ import annotations

from contextvars import ContextVar, Token
from uuid import uuid4

_REQUEST_ID: ContextVar[str] = ContextVar("didit_proxy_request_id", default="")


def normalize_request_id(value: str | None) -> str:
    candidate = (value or "").strip()
    if not candidate:
        return uuid4().hex
    return candidate[:128]


def set_request_id(value: str | None) -> Token[str]:
    return _REQUEST_ID.set(normalize_request_id(value))


def reset_request_id(token: Token[str]) -> None:
    _REQUEST_ID.reset(token)


def get_request_id() -> str:
    current = _REQUEST_ID.get().strip()
    return current or uuid4().hex
