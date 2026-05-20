from __future__ import annotations

import json
import secrets
import time
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from redis.asyncio import Redis
from starlette.responses import JSONResponse, Response

from ..audit.audit_logger import write_audit_event
from ..clients_database_client import ClientsDatabaseUpstreamClient, httpx_to_starlette_response
from ..config import Settings, get_settings
from ..security.client_ip import get_client_ip
from ..security.rate_limiter import RedisRateLimiter

router = APIRouter(prefix="/webhook", tags=["clients_database"])


class VerifyOtpRequest(BaseModel):
    email: str
    code: str


def get_clients_database_upstream(request: Request) -> ClientsDatabaseUpstreamClient:
    client = getattr(request.app.state, "clients_database_upstream_client", None)
    if client is None:
        raise HTTPException(status_code=503, detail="clients_database upstream not configured")
    return client


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _generate_verification_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _otp_key(email: str) -> str:
    return f"otp:{email}"


def _redis_dependency(request: Request) -> Redis | None:
    return getattr(request.app.state, "redis", None)


def _rate_limiter_dependency(request: Request) -> RedisRateLimiter | None:
    return getattr(request.app.state, "rate_limiter", None)


@router.post("/clients_database")
async def clients_database_proxy(
    request: Request,
    client: Annotated[ClientsDatabaseUpstreamClient, Depends(get_clients_database_upstream)],
) -> Response:
    body = await request.body()
    upstream = await client.forward_post(body, content_type=request.headers.get("content-type"))
    return httpx_to_starlette_response(upstream)


@router.post("/clients_database/send-email")
async def send_email_proxy(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    redis_client: Annotated[Redis | None, Depends(_redis_dependency)],
) -> Response:
    if not settings.send_email_url:
        raise HTTPException(status_code=503, detail="send_email upstream not configured")
    if redis_client is None:
        raise HTTPException(status_code=503, detail="OTP storage unavailable; configure REDIS_URL")

    try:
        payload = await request.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid send-email payload")

    normalized_email = _normalize_email(str(payload.get("email", "")))
    if not normalized_email:
        raise HTTPException(status_code=400, detail="email is required")

    verification_code = _generate_verification_code()
    otp_payload = {
        "code": verification_code,
        "created_at_ms": int(time.time() * 1000),
    }
    try:
        await redis_client.set(
            _otp_key(normalized_email),
            json.dumps(otp_payload, ensure_ascii=False),
            ex=settings.otp_ttl_seconds,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail="OTP storage unavailable") from exc

    payload["email"] = normalized_email
    payload["id"] = _normalize_email(str(payload.get("id", normalized_email)))
    payload["verification_code"] = verification_code
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            upstream = await client.post(
                settings.send_email_url,
                content=body,
                headers={"content-type": request.headers.get("content-type", "application/json")},
            )
    except Exception:
        await redis_client.delete(_otp_key(normalized_email))
        raise

    if upstream.status_code >= 400:
        await redis_client.delete(_otp_key(normalized_email))
        return httpx_to_starlette_response(upstream)

    await write_audit_event(
        request,
        "otp_email_requested",
        {
            "email": normalized_email,
            "companyKey": payload.get("country"),
            "platform": payload.get("platform"),
            "message_type": payload.get("message_type"),
        },
    )
    return JSONResponse({"ok": True, "codePreview": ""})


@router.post("/clients_database/verify-otp")
async def verify_otp(
    payload: VerifyOtpRequest,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    redis_client: Annotated[Redis | None, Depends(_redis_dependency)],
    rate_limiter: Annotated[RedisRateLimiter | None, Depends(_rate_limiter_dependency)],
) -> JSONResponse:
    if redis_client is None:
        raise HTTPException(status_code=503, detail="OTP storage unavailable; configure REDIS_URL")

    normalized_email = _normalize_email(payload.email)
    normalized_code = payload.code.strip()
    if not normalized_email or not normalized_code:
        return JSONResponse(status_code=400, content={"ok": False})

    if rate_limiter is not None and rate_limiter.available:
        decision = await rate_limiter.consume_identifier(
            scope="verify_otp:email",
            identifier=normalized_email,
            requests=settings.rate_limit_verify_otp_requests,
            window_seconds=settings.rate_limit_verify_otp_window_seconds,
        )
        if not decision.allowed:
            await rate_limiter.register_abuse(get_client_ip(request), route_key="verify_otp_email")
            await write_audit_event(
                request,
                "rate_limit_exceeded",
                {
                    "rule": "verify_otp_email",
                    "email": normalized_email,
                    "limit": decision.limit,
                    "count": decision.count,
                    "window_seconds": decision.window_seconds,
                },
            )
            raise HTTPException(status_code=429, detail="Too many requests")

    try:
        stored_raw = await redis_client.get(_otp_key(normalized_email))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="OTP storage unavailable") from exc

    stored_code = ""
    if stored_raw:
        try:
            stored_payload = json.loads(stored_raw)
        except json.JSONDecodeError:
            stored_payload = stored_raw
        if isinstance(stored_payload, dict):
            stored_code = str(stored_payload.get("code", "")).strip()
        else:
            stored_code = str(stored_payload).strip()

    if stored_code and secrets.compare_digest(stored_code, normalized_code):
        await redis_client.delete(_otp_key(normalized_email))
        await write_audit_event(
            request,
            "otp_verified",
            {
                "email": normalized_email,
            },
        )
        return JSONResponse({"ok": True})

    await write_audit_event(
        request,
        "otp_verification_failed",
        {
            "email": normalized_email,
        },
    )
    return JSONResponse(status_code=400, content={"ok": False})
