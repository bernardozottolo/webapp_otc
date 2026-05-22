from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request

from ..audit.audit_logger import write_audit_event
from ..config import Settings, get_settings
from ..notifications.order_local_status import detect_local_synthetic_status
from ..notifications.order_notifications import EVENT_UPDATE_EXTERNAL, EVENT_UPDATE_LOCAL, notify_order_update
from ..order_store import InMemoryOrderStore

router = APIRouter(prefix="/api/order-updates", tags=["order-updates"])


def get_order_store(request: Request) -> InMemoryOrderStore:
    store = getattr(request.app.state, "order_store", None)
    if store is None:
        raise HTTPException(status_code=503, detail="Order store not configured")
    return store


@router.post("")
@router.post("/")
async def receive_order_update(
    payload: dict[str, Any],
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    store: Annotated[InMemoryOrderStore, Depends(get_order_store)],
) -> dict[str, Any]:
    stored = store.add_update(payload)
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
    store: Annotated[InMemoryOrderStore, Depends(get_order_store)],
) -> dict[str, Any]:
    stored = store.get_record(order_id)
    if stored is None:
        raise HTTPException(status_code=404, detail="Order not found")

    synthetic_status, notify_status, local_payload = detect_local_synthetic_status(stored, settings=settings)
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
