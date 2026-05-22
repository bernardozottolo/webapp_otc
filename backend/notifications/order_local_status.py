from __future__ import annotations

import time
from typing import Any

from ..config import Settings
from .order_notifications import normalize_order_status


def detect_local_synthetic_status(
    record: dict[str, Any],
    *,
    settings: Settings,
    now_ms: int | None = None,
) -> tuple[str | None, str | None, dict[str, Any] | None]:
    """
    Espelha a lógica do frontend (orderCache.getOrderDisplayVariant) para detectar
    estados sintéticos quando não há update externo ou após timeout pós-pagamento.
    """
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    order = record.get("order")
    if not isinstance(order, dict):
        order = {}
    updates = record.get("updates")
    if not isinstance(updates, list):
        updates = []

    latest_update = updates[-1] if updates else None
    latest_template = ""
    latest_received_at = 0
    if isinstance(latest_update, dict):
        latest_template = str(latest_update.get("template", "")).strip()
        latest_received_at = int(latest_update.get("received_at", 0) or 0)

    status = normalize_order_status(str(order.get("status", "")))
    created_at = int(record.get("created_at", 0) or 0)

    payment_timeout_ms = settings.order_notification_local_payment_timeout_ms
    order_update_timeout_ms = settings.order_notification_local_order_update_timeout_ms

    if latest_template == "payment_timeout" or status == "cancelled":
        return (
            "payment_timeout",
            status or "cancelled",
            _build_local_payload(record, reason="payment_timeout", latest_update=latest_update),
        )

    if (
        status == "waiting_for_payment"
        and payment_timeout_ms > 0
        and len(updates) == 0
        and created_at > 0
        and now - created_at >= payment_timeout_ms
    ):
        return (
            "payment_timeout",
            "cancelled",
            _build_local_payload(record, reason="payment_update_timeout", latest_update=latest_update),
        )

    if (
        status == "payment_confirmed"
        and order_update_timeout_ms > 0
        and latest_update is not None
        and (
            latest_template == "payment_recognized"
            or (
                isinstance(latest_update.get("order_info"), dict)
                and normalize_order_status(str(latest_update["order_info"].get("status", "")))
                == "payment_confirmed"
            )
        )
        and latest_received_at > 0
        and now - latest_received_at >= order_update_timeout_ms
    ):
        return (
            "order_update_timeout",
            "payment_confirmed",
            _build_local_payload(record, reason="order_update_timeout", latest_update=latest_update),
        )

    return None, None, None


def _build_local_payload(
    record: dict[str, Any],
    *,
    reason: str,
    latest_update: dict[str, Any] | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "reason": reason,
        "order_snapshot": record.get("order"),
        "detected_at_ms": int(time.time() * 1000),
    }
    if latest_update is not None:
        payload["last_update"] = latest_update
    return payload
