from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..audit.audit_logger import write_audit_event
from ..config import Settings
from ..didit_client import DiditClient
from ..didit_vendor_data import is_biometric_vendor_data, is_document_vendor_data
from ..security.client_ip import get_client_ip

router = APIRouter(prefix="/webhook/didit", tags=["didit"])


class CreateDiditSessionRequest(BaseModel):
    flow_kind: str | None = None
    language: str
    vendor_data: str
    expected_details: dict[str, Any] | None = None
    metadata: dict[str, Any]
    portrait_image: str | None = None


class CreateBiometricSessionFromDocumentRequest(BaseModel):
    language: str
    document_verification_vendor_data: str
    biometric_validation_vendor_data: str
    expected_details: dict[str, Any] | None = None
    metadata: dict[str, Any]


def _first_id_verification(decision: dict[str, Any]) -> dict[str, Any] | None:
    raw_list = decision.get("id_verifications") or decision.get("idVerifications")
    if isinstance(raw_list, list) and raw_list:
        first = raw_list[0]
        return first if isinstance(first, dict) else None

    raw_single = decision.get("id_verification") or decision.get("idVerification")
    return raw_single if isinstance(raw_single, dict) else None


def _portrait_image_from_decision(decision: dict[str, Any]) -> str | None:
    id_verification = _first_id_verification(decision)
    if not id_verification:
        return None
    portrait = id_verification.get("portrait_image") or id_verification.get("portraitImage")
    return portrait if isinstance(portrait, str) and portrait.strip() else None


def _expected_details_from_id_verification(id_verification: dict[str, Any]) -> dict[str, str] | None:
    first = id_verification.get("first_name") or id_verification.get("firstName") or ""
    if not isinstance(first, str):
        first = str(first).strip() if first else ""
    first = first.strip()
    if not first:
        full = id_verification.get("full_name") or id_verification.get("fullName") or ""
        if isinstance(full, str) and full.strip():
            first = full.strip().split()[0]
    dob_raw = id_verification.get("date_of_birth") or id_verification.get("dateOfBirth")
    dob = dob_raw.strip() if isinstance(dob_raw, str) else (str(dob_raw).strip() if dob_raw is not None else "")
    if first and dob:
        return {"first_name": first, "date_of_birth": dob}
    return None


def _merge_expected_details(
    payload_details: dict[str, Any] | None, decision: dict[str, Any]
) -> dict[str, str] | None:
    if payload_details and isinstance(payload_details, dict):
        fn = str(payload_details.get("first_name", "")).strip()
        dob = str(payload_details.get("date_of_birth", "")).strip()
        if fn and dob:
            return {"first_name": fn, "date_of_birth": dob}
    idv = _first_id_verification(decision)
    if idv:
        merged = _expected_details_from_id_verification(idv)
        if merged:
            return merged
    return None


def _didit_client_dependency() -> DiditClient:
    from ..main import app

    return app.state.didit_client  # type: ignore[no-any-return]


def _settings_dependency(request: Request) -> Settings:
    settings = getattr(request.app.state, "settings", None)
    if settings is None:
        raise HTTPException(status_code=503, detail="App settings not configured")
    return settings  # type: ignore[no-any-return]


def _biometric_rate_limiter_dependency(request: Request) -> Any:
    limiter = getattr(request.app.state, "biometric_rate_limiter", None)
    if limiter is None:
        raise HTTPException(status_code=503, detail="Biometric rate limiter not configured")
    return limiter


def _enforce_biometric_rate_limit(request: Request, limiter: Any) -> None:
    decision = limiter.consume(get_client_ip(request))
    if decision.allowed:
        return
    raise HTTPException(
        status_code=429,
        detail=(
            f"Biometric verification daily limit reached for this IP "
            f"({decision.limit} per day). Try again tomorrow."
        ),
    )


def _resolve_callback(settings: Settings) -> str:
    if settings.didit_callback_url:
        return settings.didit_callback_url
    raise HTTPException(status_code=503, detail="Didit callback URL not configured")


def _resolve_waiting_url(metadata: dict[str, Any], settings: Settings) -> dict[str, Any]:
    clean_metadata = dict(metadata)
    clean_metadata.pop("waiting_url", None)

    if not settings.didit_waiting_url:
        return clean_metadata

    return {
        **clean_metadata,
        "waiting_url": settings.didit_waiting_url,
    }


def _resolve_workflow_id(vendor_data: str, settings: Settings) -> str:
    if is_biometric_vendor_data(vendor_data) and settings.didit_biometric_validation_workflow_id:
        return settings.didit_biometric_validation_workflow_id

    if is_document_vendor_data(vendor_data) and settings.didit_document_verification_workflow_id:
        return settings.didit_document_verification_workflow_id

    raise HTTPException(status_code=503, detail="Didit workflow ID not configured")


def _parse_timestamp_maybe(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        numeric = float(value)
        if numeric > 1e14:
            return int(numeric)
        if numeric > 1e12:
            return int(numeric)
        if numeric > 1e9:
            return int(numeric * 1000)
        return None
    if isinstance(value, str) and value.strip():
        trimmed = value.strip()
        if trimmed.isdigit():
            return _parse_timestamp_maybe(int(trimmed))
        try:
            return int(datetime.fromisoformat(trimmed.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            return None
    return None


def _pick_verification_completed_at_ms(value: Any, depth: int = 0) -> int | None:
    if depth > 8 or not isinstance(value, (dict, list)):
        return None
    keys = (
        "verification_completed_at_ms",
        "verificationCompletedAtMs",
        "completed_at",
        "completedAt",
        "approval_completed_at",
        "approvalCompletedAt",
        "approved_at",
        "approvedAt",
        "evaluation_completed_at",
        "evaluationCompletedAt",
        "decision_completed_at",
        "decisionCompletedAt",
        "verified_at",
        "verifiedAt",
        "decision_date",
        "decisionDate",
        "updated_at",
        "updatedAt",
        "created_at",
        "createdAt",
    )
    if isinstance(value, dict):
        for key in keys:
            parsed = _parse_timestamp_maybe(value.get(key))
            if parsed is not None:
                return parsed
        for path in ("decision", "metadata", "session", "session_update", "sessionUpdate", "raw", "evaluation"):
            nested = value.get(path)
            if isinstance(nested, (dict, list)):
                parsed = _pick_verification_completed_at_ms(nested, depth + 1)
                if parsed is not None:
                    return parsed
        return None
    for item in value:
        parsed = _pick_verification_completed_at_ms(item, depth + 1)
        if parsed is not None:
            return parsed
    return None


def _sanitize_session_summary(session: dict[str, Any]) -> dict[str, Any]:
    return {
        "session_id": session.get("session_id") or session.get("sessionId"),
        "status": session.get("status"),
        "vendor_data": session.get("vendor_data") or session.get("vendorData"),
        "workflow_id": session.get("workflow_id") or session.get("workflowId"),
        "verification_completed_at_ms": _pick_verification_completed_at_ms(session),
        "session_token": session.get("session_token") or session.get("sessionToken"),
        "session_url": (
            session.get("session_url")
            or session.get("sessionUrl")
            or session.get("verification_url")
            or session.get("verificationUrl")
            or session.get("url")
        ),
    }


def _sanitize_decision(decision: dict[str, Any]) -> dict[str, Any]:
    id_verifications_raw = decision.get("id_verifications") or decision.get("idVerifications") or []
    if not isinstance(id_verifications_raw, list):
        id_verifications_raw = []
    sanitized_id_verifications = [
        {
            "status": item.get("status"),
            "portrait_image": item.get("portrait_image") or item.get("portraitImage"),
        }
        for item in id_verifications_raw
        if isinstance(item, dict)
    ]
    return {
        "session_id": decision.get("session_id") or decision.get("sessionId"),
        "status": decision.get("status"),
        "vendor_data": decision.get("vendor_data") or decision.get("vendorData"),
        "verification_completed_at_ms": _pick_verification_completed_at_ms(decision),
        "id_verifications": sanitized_id_verifications,
    }


def _raise_upstream_http_error(error: httpx.HTTPStatusError) -> None:
    raise HTTPException(
        status_code=error.response.status_code,
        detail="Didit upstream request failed.",
    ) from error


@router.post("/session")
async def create_session(
    payload: CreateDiditSessionRequest,
    request: Request,
    didit_client: DiditClient = Depends(_didit_client_dependency),
    biometric_rate_limiter: Any = Depends(_biometric_rate_limiter_dependency),
    settings: Settings = Depends(_settings_dependency),
) -> dict[str, Any]:
    if is_biometric_vendor_data(payload.vendor_data):
        _enforce_biometric_rate_limit(request, biometric_rate_limiter)
    resolved_payload = payload.model_dump(exclude_none=True)
    resolved_payload["workflow_id"] = _resolve_workflow_id(payload.vendor_data, settings)
    resolved_payload["callback"] = _resolve_callback(settings)
    resolved_payload["metadata"] = _resolve_waiting_url(dict(payload.metadata), settings)
    
    try:
        session = await didit_client.create_session(resolved_payload)
    except httpx.HTTPStatusError as error:
        _raise_upstream_http_error(error)
    sanitized = _sanitize_session_summary(session)
    await write_audit_event(
        request,
        "didit_session_created",
        {
            "request_body": payload.model_dump(exclude_none=True),
            "vendor_data": payload.vendor_data,
            "flow_kind": payload.flow_kind,
            "session_id": sanitized.get("session_id"),
            "metadata": payload.metadata,
            "session": session,
        },
        sanitize=False,
    )
    return {
        "success": True,
        "data": sanitized,
    }


@router.get("/sessions")
async def list_sessions(
    search: str,
    status: str | None = None,
    limit: int | None = None,
    didit_client: DiditClient = Depends(_didit_client_dependency),
) -> dict[str, Any]:
    try:
        payload = await didit_client.list_sessions(
            search=search.strip(),
            status=status.strip() if status else None,
            limit=limit,
        )
    except httpx.HTTPStatusError as error:
        _raise_upstream_http_error(error)
    return {
        "success": True,
        "results": [
            _sanitize_session_summary(item)
            for item in payload.get("results", [])
            if isinstance(item, dict)
        ],
    }


@router.get("/session/{session_id}/decision")
async def get_session_decision(
    session_id: str,
    request: Request,
    didit_client: DiditClient = Depends(_didit_client_dependency),
) -> dict[str, Any]:
    try:
        decision = await didit_client.get_session_decision(session_id)
    except httpx.HTTPStatusError as error:
        _raise_upstream_http_error(error)
    await write_audit_event(
        request,
        "didit_biometry_status_updated",
        {
            "session_id": session_id,
            "decision": decision,
        },
        sanitize=False,
    )
    return {
        "success": True,
        "data": _sanitize_decision(decision),
    }


@router.post("/biometric-session-from-document")
async def create_biometric_session_from_document(
    payload: CreateBiometricSessionFromDocumentRequest,
    request: Request,
    didit_client: DiditClient = Depends(_didit_client_dependency),
    biometric_rate_limiter: Any = Depends(_biometric_rate_limiter_dependency),
    settings: Settings = Depends(_settings_dependency),
) -> dict[str, Any]:
    try:
        sessions_payload = await didit_client.list_sessions(
            search=payload.document_verification_vendor_data,
            status="Approved",
            limit=1,
        )
    except httpx.HTTPStatusError as error:
        _raise_upstream_http_error(error)
    sessions = sessions_payload.get("results", [])
    if not isinstance(sessions, list) or not sessions:
        raise HTTPException(status_code=404, detail="Approved document verification session not found.")

    first_session = sessions[0]
    if not isinstance(first_session, dict):
        raise HTTPException(status_code=502, detail="Unexpected Didit sessions payload.")

    session_id = first_session.get("session_id") or first_session.get("sessionId")
    if not isinstance(session_id, str) or not session_id:
        raise HTTPException(status_code=502, detail="Didit session id missing from approved document verification.")

    try:
        decision = await didit_client.get_session_decision(session_id)
    except httpx.HTTPStatusError as error:
        _raise_upstream_http_error(error)
    portrait_image_url = _portrait_image_from_decision(decision)
    if not portrait_image_url:
        raise HTTPException(status_code=404, detail="Portrait image not found in approved document verification.")

    try:
        portrait_image_base64 = await didit_client.image_url_to_base64(portrait_image_url)
        merged_expected = _merge_expected_details(payload.expected_details, decision)
        if merged_expected is None:
            raise HTTPException(
                status_code=400,
                detail="expected_details is required for biometric session; could not derive first_name and date_of_birth.",
            )
        upstream_payload = {
            "workflow_id": _resolve_workflow_id(
                payload.biometric_validation_vendor_data,
                settings,
            ),
            "callback": _resolve_callback(settings),
            "language": payload.language,
            "vendor_data": payload.biometric_validation_vendor_data,
            "expected_details": merged_expected,
            "portrait_image": portrait_image_base64,
            "metadata": _resolve_waiting_url(dict(payload.metadata), settings),
        }
        _enforce_biometric_rate_limit(request, biometric_rate_limiter)
        session = await didit_client.create_session(
            upstream_payload
        )
    except httpx.HTTPStatusError as error:
        _raise_upstream_http_error(error)

    sanitized = _sanitize_session_summary(session)
    await write_audit_event(
        request,
        "didit_biometric_session_created",
        {
            "request_body": payload.model_dump(exclude_none=True),
            "document_verification_vendor_data": payload.document_verification_vendor_data,
            "biometric_validation_vendor_data": payload.biometric_validation_vendor_data,
            "session_id": sanitized.get("session_id"),
            "metadata": payload.metadata,
            "decision": decision,
            "session": session,
        },
        sanitize=False,
    )
    return {
        "success": True,
        "data": sanitized,
    }
