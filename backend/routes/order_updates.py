from __future__ import annotations

import json
import logging
import traceback
from typing import Annotated, Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request

from ..audit.audit_logger import write_audit_event
from ..config import Settings, get_settings
from ..notifications.order_local_status import detect_local_synthetic_status
from ..notifications.order_notifications import EVENT_UPDATE_EXTERNAL, EVENT_UPDATE_LOCAL, notify_order_update
from ..order_store import OrderStore
from ..request_context import get_request_id
from ..security.client_ip import get_client_ip

router = APIRouter(prefix="/api/order-updates", tags=["order-updates"])
logger = logging.getLogger("didit_proxy.order_updates")


def _redact_redis_url(redis_url: str) -> str:
    parsed = urlparse(redis_url)
    if not parsed.scheme:
        return "[invalid]"
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    db = parsed.path or ""
    auth = "***@" if parsed.username or parsed.password else ""
    return f"{parsed.scheme}://{auth}{host}{port}{db}"


def _order_store_backend(request: Request) -> str:
    redis = getattr(request.app.state, "redis", None)
    return "redis" if redis is not None else "memory"


def _build_get_failure_context(
    request: Request,
    order_id: str,
    *,
    status_code: int,
    reason: str,
    exc: BaseException | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    settings = getattr(request.app.state, "settings", None)
    redis_url = str(getattr(settings, "redis_url", "") or "").strip()
    context: dict[str, Any] = {
        "event": "order_updates_get_failed",
        "order_id": order_id,
        "status_code": status_code,
        "reason": reason,
        "request_id": getattr(request.state, "request_id", None) or get_request_id(),
        "ip": get_client_ip(request),
        "method": request.method,
        "path": request.url.path,
        "url": str(request.url),
        "query": request.url.query or None,
        "user_agent": request.headers.get("user-agent", ""),
        "referer": request.headers.get("referer", ""),
        "accept": request.headers.get("accept", ""),
        "origin": request.headers.get("origin", ""),
        "host": request.headers.get("host", ""),
        "x_forwarded_for": request.headers.get("x-forwarded-for", ""),
        "x_real_ip": request.headers.get("x-real-ip", ""),
        "x_request_id": request.headers.get("x-request-id", ""),
        "order_store_backend": _order_store_backend(request),
        "redis_configured": bool(redis_url),
        "redis_url_redacted": _redact_redis_url(redis_url) if redis_url else None,
        "touch_ttl": True,
    }
    if exc is not None:
        context["exception_type"] = type(exc).__name__
        context["exception_message"] = str(exc)
        context["traceback"] = traceback.format_exc()
    if extra:
        context.update(extra)
    return context


def _log_get_order_updates_failure(
    request: Request,
    order_id: str,
    *,
    status_code: int,
    reason: str,
    exc: BaseException | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    context = _build_get_failure_context(
        request,
        order_id,
        status_code=status_code,
        reason=reason,
        exc=exc,
        extra=extra,
    )
    payload = json.dumps(context, ensure_ascii=False, default=str)
    if status_code >= 500 or exc is not None:
        logger.error("order_updates_get_failed %s", payload)
        return
    logger.warning("order_updates_get_failed %s", payload)


def get_order_store(request: Request) -> OrderStore:
    store = getattr(request.app.state, "order_store", None)
    if store is None:
        order_id = str(request.path_params.get("order_id", "")).strip() or None
        _log_get_order_updates_failure(
            request,
            order_id or "[unknown]",
            status_code=503,
            reason="order_store_not_configured",
            extra={"dependency": "get_order_store"},
        )
        raise HTTPException(status_code=503, detail="Order store not configured")
    return store


@router.post("")
@router.post("/")
async def receive_order_update(
    payload: dict[str, Any],
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    store: Annotated[OrderStore, Depends(get_order_store)],
) -> dict[str, Any]:
    stored = await store.add_update(payload)
    if stored is None:
        raise HTTPException(status_code=400, detail="order_info.order_id is required")
    order_info = payload.get("order_info") if isinstance(payload.get("order_info"), dict) else {}
    await write_audit_event(
        request,
        "order_update_received",
        {
            "source": "external",
            "order_id": order_info.get("order_id"),
            "status": order_info.get("status"),
            "payload": payload,
        },
        sanitize=False,
    )
    await notify_order_update(
        settings=settings,
        event=EVENT_UPDATE_EXTERNAL,
        update_body=payload,
        redis_client=getattr(request.app.state, "redis", None),
    )
    return {"success": True, **stored}


@router.get("/{order_id}")
async def get_order_updates(
    order_id: str,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    store: Annotated[OrderStore, Depends(get_order_store)],
) -> dict[str, Any]:
    try:
        stored = await store.get_record(order_id, touch_ttl=True)
        if stored is None:
            _log_get_order_updates_failure(
                request,
                order_id,
                status_code=404,
                reason="order_not_found",
            )
            raise HTTPException(status_code=404, detail="Order not found")

        try:
            synthetic_status, notify_status, local_payload = detect_local_synthetic_status(stored, settings=settings)
        except Exception as exc:
            _log_get_order_updates_failure(
                request,
                order_id,
                status_code=500,
                reason="synthetic_status_detection_failed",
                exc=exc,
            )
            raise HTTPException(status_code=500, detail="Failed to process order updates") from exc

        if synthetic_status and local_payload is not None:
            await write_audit_event(
                request,
                "order_update_local_detected",
                {
                    "source": "local",
                    "order_id": order_id,
                    "status": notify_status or synthetic_status,
                    "payload": local_payload,
                    "stored_record": stored,
                },
                sanitize=False,
            )
            await notify_order_update(
                settings=settings,
                event=EVENT_UPDATE_LOCAL,
                order_id=order_id,
                status=notify_status or synthetic_status,
                local_payload=local_payload,
                redis_client=getattr(request.app.state, "redis", None),
            )

        return stored
    except HTTPException:
        raise
    except Exception as exc:
        _log_get_order_updates_failure(
            request,
            order_id,
            status_code=500,
            reason="unexpected_error",
            exc=exc,
        )
        raise HTTPException(status_code=500, detail="Failed to fetch order updates") from exc


@router.patch("/{order_id}/client-flags")
async def patch_order_client_flags(
    order_id: str,
    payload: dict[str, Any],
    request: Request,
    store: Annotated[OrderStore, Depends(get_order_store)],
) -> dict[str, Any]:
    stored = await store.set_client_flags(order_id, payload)
    if stored is None:
        raise HTTPException(status_code=404, detail="Order not found")
    await write_audit_event(
        request,
        "order_client_flags_updated",
        {
            "order_id": order_id,
            "client_flags": stored.get("client_flags"),
        },
        sanitize=False,
    )
    return stored
