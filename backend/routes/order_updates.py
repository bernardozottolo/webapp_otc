from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request

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
    store: Annotated[InMemoryOrderStore, Depends(get_order_store)],
) -> dict[str, Any]:
    stored = store.add_update(payload)
    if stored is None:
        raise HTTPException(status_code=400, detail="order_info.order_id is required")
    return {"success": True, **stored}


@router.get("/{order_id}")
async def get_order_updates(
    order_id: str,
    store: Annotated[InMemoryOrderStore, Depends(get_order_store)],
) -> dict[str, Any]:
    stored = store.get_record(order_id)
    if stored is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return stored
