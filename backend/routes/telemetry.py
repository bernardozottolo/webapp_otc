from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ..audit.audit_logger import write_audit_event

router = APIRouter(prefix="/api/telemetry", tags=["telemetry"])


class FrontendTelemetryEvent(BaseModel):
    event: str
    occurred_at: str | None = None
    step: str | None = None
    user_context: dict[str, Any] = Field(default_factory=dict)
    payload: dict[str, Any] = Field(default_factory=dict)


@router.post("/frontend-event")
async def frontend_event(payload: FrontendTelemetryEvent, request: Request) -> dict[str, bool]:
    event_name = payload.event.strip()
    if not event_name:
        return {"ok": False}

    await write_audit_event(
        request,
        event_name,
        {
            "occurred_at": payload.occurred_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "step": payload.step,
            "user_context": payload.user_context,
            "payload": payload.payload,
            "source": "frontend",
        },
        sanitize=False,
    )
    return {"ok": True}
