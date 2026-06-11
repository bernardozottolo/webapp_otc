from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

import httpx
from redis.asyncio import Redis

from ..config import Settings
from .payload_utils import sanitize_notification_payload, truncate_envelope

logger = logging.getLogger("didit_proxy.order_notifications")

SOURCE = "webapp_otc"
EVENT_CREATED = "order_created"
EVENT_UPDATE_EXTERNAL = "order_update_external"
EVENT_UPDATE_LOCAL = "order_update_local"


def normalize_order_status(value: str | None) -> str:
    if not value:
        return ""
    normalized = value.strip()
    normalized = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", normalized)
    return normalized.lower().replace("-", "_").replace(" ", "_")


def _status_aliases(status: str) -> set[str]:
    aliases = {status}
    if status == "concluded":
        aliases.add("completed")
    if status == "completed":
        aliases.add("concluded")
    if status == "cancelled":
        aliases.add("canceled")
    if status == "payment_timeout":
        aliases.add("timeout")
    if status == "order_update_timeout":
        aliases.add("timeout")
    return aliases


def should_notify_order_update(status: str | None, settings: Settings) -> bool:
    normalized = normalize_order_status(status)
    if not normalized:
        return False
    allowed = settings.order_notification_statuses
    if normalized in allowed:
        return True
    return bool(_status_aliases(normalized) & allowed)


def _extract_status_from_update_body(update_body: dict[str, Any]) -> str:
    template = normalize_order_status(str(update_body.get("template", "")))
    order_info = update_body.get("order_info")
    order_status = ""
    if isinstance(order_info, dict):
        order_status = normalize_order_status(str(order_info.get("status", "")))
    if template == "payment_processing":
        return order_status or "processing"
    if template == "order_concluded":
        return order_status or "concluded"
    if template == "payment_timeout":
        return order_status or "payment_timeout"
    if template == "payment_reproved":
        return order_status or "reproved"
    return order_status or template


def _pick_pre_order_value(pre_order: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in pre_order and pre_order[key] is not None:
            return pre_order[key]
    return None


def extract_create_order_summary(request_body: dict[str, Any]) -> dict[str, Any]:
    """Campos de negócio do create_order (request), alinhados ao snapshot local."""
    pre_order = request_body.get("pre_order")
    pre = pre_order if isinstance(pre_order, dict) else {}

    trade_type = str(request_body.get("trade_type", "")).strip().upper() or None
    asset = str(request_body.get("asset", "")).strip() or None
    amount_to_pay = _pick_pre_order_value(pre_order, "input_amount", "amount_to_pay")
    amount_to_receive = _pick_pre_order_value(
        pre_order,
        "output_amount_net",
        "final_amount_to_receive",
        "total_amount_to_receive",
    )
    price = _pick_pre_order_value(pre_order, "price")
    if price is None:
        price = request_body.get("price")

    summary: dict[str, Any] = {}
    if trade_type:
        summary["trade_type"] = trade_type
    if asset:
        summary["asset"] = asset
    if amount_to_pay is not None:
        summary["amount_to_pay"] = amount_to_pay
    if amount_to_receive is not None:
        summary["amount_to_receive"] = amount_to_receive
    if price is not None:
        summary["price"] = price
    return summary


def _build_envelope(
    *,
    event: str,
    settings: Settings,
    order_id: str | None,
    status: str | None,
    payload: dict[str, Any],
    email: str | None = None,
    client_id: str | None = None,
    trade_type: str | None = None,
    asset: str | None = None,
    amount_to_pay: Any = None,
    amount_to_receive: Any = None,
    price: Any = None,
) -> dict[str, Any]:
    envelope: dict[str, Any] = {
        "event": event,
        "source": SOURCE,
        "company_key": settings.backend_company_key,
        "platform": settings.backend_platform,
        "occurred_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "order_id": order_id,
        "status": status,
        "payload": payload,
    }
    if email:
        envelope["email"] = email
    if client_id:
        envelope["client_id"] = client_id
    if trade_type:
        envelope["trade_type"] = trade_type
    if asset:
        envelope["asset"] = asset
    if amount_to_pay is not None:
        envelope["amount_to_pay"] = amount_to_pay
    if amount_to_receive is not None:
        envelope["amount_to_receive"] = amount_to_receive
    if price is not None:
        envelope["price"] = price
    return envelope


async def _dedup_should_send(
    redis_client: Redis | None,
    *,
    event: str,
    order_id: str | None,
    status: str | None,
    payload: dict[str, Any],
    settings: Settings,
) -> bool:
    if redis_client is None:
        return True
    fingerprint = hashlib.sha256(
        json.dumps(
            {"event": event, "order_id": order_id, "status": status, "payload": payload},
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        ).encode("utf-8")
    ).hexdigest()[:24]
    key = f"order_notification_sent:{event}:{order_id or 'unknown'}:{status or 'unknown'}:{fingerprint}"
    try:
        inserted = await redis_client.set(key, "1", ex=settings.order_notification_dedup_ttl_seconds, nx=True)
        return bool(inserted)
    except Exception as exc:
        logger.warning("order notification dedup unavailable: %s", exc)
        return True


def _is_configured(settings: Settings) -> bool:
    if not settings.order_notification_enabled:
        return False
    if not settings.order_notification_url:
        return False
    return True


def _log_skip_reason(settings: Settings, *, event: str, order_id: str | None, status: str | None) -> None:
    if not settings.order_notification_enabled:
        logger.info(
            "order_notification_skipped_disabled order_id=%s status=%s event=%s",
            order_id,
            status,
            event,
        )
        return
    if not settings.order_notification_url:
        logger.warning(
            "ORDER_NOTIFICATION_ENABLED but ORDER_NOTIFICATION_URL is empty; skipping notification order_id=%s event=%s",
            order_id,
            event,
        )


async def _post_notification(
    envelope: dict[str, Any],
    *,
    settings: Settings,
    log_sent: str,
    log_failed: str,
) -> None:

    final_envelope = truncate_envelope(envelope, settings.order_notification_max_body_chars)
    try:
        async with httpx.AsyncClient(timeout=settings.order_notification_timeout_seconds) as client:
            response = await client.post(
                settings.order_notification_url,
                json=final_envelope,
                headers={"content-type": "application/json", "accept": "application/json"},
            )
        response.raise_for_status()
        logger.info(
            "%s order_id=%s status=%s event=%s",
            log_sent,
            final_envelope.get("order_id"),
            final_envelope.get("status"),
            final_envelope.get("event"),
        )
    except Exception as exc:
        logger.warning(
            "%s order_id=%s status=%s event=%s error=%s",
            log_failed,
            envelope.get("order_id"),
            envelope.get("status"),
            envelope.get("event"),
            exc,
        )


async def notify_order_created(
    *,
    settings: Settings,
    request_body: dict[str, Any] | None = None,
    response_body: dict[str, Any],
    order_id: str | None = None,
    status: str | None = None,
    email: str | None = None,
    client_id: str | None = None,
    redis_client: Redis | None = None,
) -> None:
    if not _is_configured(settings):
        _log_skip_reason(settings, event=EVENT_CREATED, order_id=order_id, status=status)
        return

    order_details = response_body.get("order_details")
    if order_id is None and isinstance(order_details, dict):
        order_id = str(order_details.get("order_id", "")).strip() or None
    if status is None and isinstance(order_details, dict):
        status = str(order_details.get("status", "")).strip() or None

    order_summary = extract_create_order_summary(request_body) if request_body else {}

    sanitized_request = (
        sanitize_notification_payload(request_body, allow_qr_on_create=False)
        if request_body
        else None
    )
    sanitized_response = sanitize_notification_payload(response_body, allow_qr_on_create=True)
    payload: dict[str, Any] = {"response_body": sanitized_response}
    if sanitized_request is not None:
        payload["request_body"] = sanitized_request
    if order_summary:
        payload.update(order_summary)
    if email:
        payload["email"] = email
    if client_id:
        payload["client_id"] = client_id

    envelope = _build_envelope(
        event=EVENT_CREATED,
        settings=settings,
        order_id=order_id,
        status=status,
        payload=payload,
        email=email,
        client_id=client_id,
        trade_type=order_summary.get("trade_type"),
        asset=order_summary.get("asset"),
        amount_to_pay=order_summary.get("amount_to_pay"),
        amount_to_receive=order_summary.get("amount_to_receive"),
        price=order_summary.get("price"),
    )
    if not await _dedup_should_send(
        redis_client,
        event=EVENT_CREATED,
        order_id=order_id,
        status=normalize_order_status(status),
        payload=payload,
        settings=settings,
    ):
        return

    await _post_notification(
        envelope,
        settings=settings,
        log_sent="order_notification_created_sent",
        log_failed="order_notification_created_failed",
    )


async def notify_order_update(
    *,
    settings: Settings,
    event: str,
    update_body: dict[str, Any] | None = None,
    order_id: str | None = None,
    status: str | None = None,
    local_payload: dict[str, Any] | None = None,
    redis_client: Redis | None = None,
) -> None:
    if not _is_configured(settings):
        _log_skip_reason(settings, event=event, order_id=order_id, status=status)
        return

    if update_body is not None:
        status = status or _extract_status_from_update_body(update_body)
        order_info = update_body.get("order_info")
        if order_id is None and isinstance(order_info, dict):
            order_id = str(order_info.get("order_id", "")).strip() or None

    normalized_status = normalize_order_status(status)
    if not should_notify_order_update(normalized_status, settings):
        logger.info(
            "order_notification_skipped_unmapped_status order_id=%s status=%s event=%s",
            order_id,
            normalized_status,
            event,
        )
        return

    if event == EVENT_UPDATE_EXTERNAL and update_body is not None:
        inner_payload = {
            "update_body": sanitize_notification_payload(update_body, allow_qr_on_create=False),
        }
    elif event == EVENT_UPDATE_LOCAL and local_payload is not None:
        inner_payload = sanitize_notification_payload(local_payload, allow_qr_on_create=False)
    else:
        inner_payload = {}

    envelope = _build_envelope(
        event=event,
        settings=settings,
        order_id=order_id,
        status=status,
        payload=inner_payload,
    )
    if not await _dedup_should_send(
        redis_client,
        event=event,
        order_id=order_id,
        status=normalized_status,
        payload=inner_payload,
        settings=settings,
    ):
        return

    await _post_notification(
        envelope,
        settings=settings,
        log_sent="order_notification_update_sent",
        log_failed="order_notification_update_failed",
    )
