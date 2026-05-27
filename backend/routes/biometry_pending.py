from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from redis.asyncio import Redis

from ..audit.audit_logger import write_audit_event
from ..biometry_pending.service import BiometryPendingService
from ..clients_database_client import ClientsDatabaseUpstreamClient
from ..config import Settings, get_settings
from ..didit_client import DiditClient

router = APIRouter(prefix="/webhook/biometry-pending", tags=["biometry-pending"])


class RegisterBiometryPendingRequest(BaseModel):
    session_id: str = Field(min_length=1)
    session_status: str = Field(min_length=1)
    action: Literal["onboarding", "wallet_save"]
    email: str = Field(min_length=1)
    asset: str | None = None
    action_payload: dict[str, Any] = Field(default_factory=dict)


class NotifyImmediateBiometryApprovalRequest(BaseModel):
    action: Literal["wallet_save"]
    email: str = Field(min_length=1)
    asset: str | None = None
    session_id: str | None = None


def _redis_dependency(request: Request) -> Redis | None:
    return getattr(request.app.state, "redis", None)


def _settings_dependency(request: Request) -> Settings:
    settings = getattr(request.app.state, "settings", None)
    if settings is None:
        raise HTTPException(status_code=503, detail="App settings not configured")
    return settings  # type: ignore[no-any-return]


def _didit_client_dependency(request: Request) -> DiditClient:
    client = getattr(request.app.state, "didit_client", None)
    if client is None:
        raise HTTPException(status_code=503, detail="Didit client not configured")
    return client  # type: ignore[no-any-return]


def _clients_db_dependency(request: Request) -> ClientsDatabaseUpstreamClient | None:
    return getattr(request.app.state, "clients_database_upstream_client", None)


def _service_dependency(
    redis_client: Annotated[Redis | None, Depends(_redis_dependency)],
    settings: Annotated[Settings, Depends(_settings_dependency)],
    didit_client: Annotated[DiditClient, Depends(_didit_client_dependency)],
    clients_db_client: Annotated[ClientsDatabaseUpstreamClient | None, Depends(_clients_db_dependency)],
) -> BiometryPendingService:
    if redis_client is None:
        raise HTTPException(status_code=503, detail="Redis unavailable; configure REDIS_URL")
    return BiometryPendingService(
        redis_client=redis_client,
        settings=settings,
        didit_client=didit_client,
        clients_db_client=clients_db_client,
    )


@router.get("/check")
async def check_biometry_pending(
    action: Literal["onboarding", "wallet_save"],
    email: str,
    asset: str | None = None,
    document_number: str | None = None,
    service: BiometryPendingService = Depends(_service_dependency),
) -> dict[str, Any]:
    return await service.check_blocked(
        action=action,
        email=email,
        asset=asset,
        document_number=document_number,
    )


@router.post("/register")
async def register_biometry_pending(
    payload: RegisterBiometryPendingRequest,
    request: Request,
    service: BiometryPendingService = Depends(_service_dependency),
) -> dict[str, Any]:
    result = await service.register(
        session_id=payload.session_id,
        session_status=payload.session_status,
        action=payload.action,
        email=payload.email,
        asset=payload.asset,
        action_payload=payload.action_payload,
    )
    await write_audit_event(
        request,
        "biometry_pending_registered",
        {
            "session_id": payload.session_id,
            "action": payload.action,
            "email": payload.email.strip().lower(),
            "asset": payload.asset,
            "action_payload": payload.action_payload,
        },
        sanitize=False,
    )
    return {"success": True, "data": result}


@router.post("/notify-immediate-approval")
async def notify_immediate_biometry_approval(
    payload: NotifyImmediateBiometryApprovalRequest,
    request: Request,
    service: BiometryPendingService = Depends(_service_dependency),
) -> dict[str, Any]:
    result = await service.notify_immediate_approval(
        action=payload.action,
        email=payload.email,
        asset=payload.asset,
        session_id=payload.session_id,
    )
    await write_audit_event(
        request,
        "biometry_immediate_approval_notified",
        {
            "action": payload.action,
            "email": payload.email.strip().lower(),
            "asset": payload.asset,
            "session_id": payload.session_id,
            "message_type": result.get("messageType"),
        },
        sanitize=False,
    )
    return {"success": True, "data": result}
