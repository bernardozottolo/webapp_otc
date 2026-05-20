from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..audit.audit_logger import write_audit_event
from ..security.ip_blacklist import IpBlacklistService

router = APIRouter(prefix="/admin/security", tags=["admin-security"])


class AddBlacklistRequest(BaseModel):
    ip: str
    reason: str
    ttl_seconds: int | None = None


def _require_admin_token(
    request: Request,
) -> None:
    settings = getattr(request.app.state, "settings", None)
    expected_token = getattr(settings, "admin_security_token", "") if settings is not None else ""
    if not expected_token:
        raise HTTPException(status_code=503, detail="Admin security token not configured")
    admin_token = request.headers.get("x-admin-security-token")
    if admin_token != expected_token:
        raise HTTPException(status_code=403, detail="Invalid admin token")


def _get_blacklist_service(request: Request) -> IpBlacklistService:
    service = getattr(request.app.state, "ip_blacklist_service", None)
    if service is None or not service.available:
        raise HTTPException(status_code=503, detail="IP blacklist not available")
    return service  # type: ignore[no-any-return]


@router.get("/blacklist")
async def list_blacklist(request: Request) -> dict[str, object]:
    _require_admin_token(request)
    service = _get_blacklist_service(request)
    entries = await service.list_blacklisted_ips()
    return {"items": entries}


@router.post("/blacklist")
async def add_blacklist(
    payload: AddBlacklistRequest,
    request: Request,
) -> dict[str, bool]:
    _require_admin_token(request)
    service = _get_blacklist_service(request)
    await service.add_ip_to_blacklist(payload.ip.strip(), payload.reason.strip(), payload.ttl_seconds)
    await write_audit_event(
        request,
        "blacklist_added",
        {"ip": payload.ip.strip(), "reason": payload.reason.strip(), "ttl_seconds": payload.ttl_seconds},
    )
    return {"ok": True}


@router.delete("/blacklist/{ip}")
async def delete_blacklist(
    ip: str,
    request: Request,
) -> dict[str, bool]:
    _require_admin_token(request)
    service = _get_blacklist_service(request)
    await service.remove_ip_from_blacklist(ip.strip())
    await write_audit_event(request, "blacklist_removed", {"ip": ip.strip()})
    return {"ok": True}
