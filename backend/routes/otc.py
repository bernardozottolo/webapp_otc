from __future__ import annotations

import json
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.responses import Response

from ..audit.audit_logger import write_audit_event
from ..config import Settings, get_settings
from ..notifications.order_notifications import notify_order_created
from ..otc_client import OtcUpstreamClient, httpx_to_starlette_response

router = APIRouter(prefix="/otc", tags=["otc"])


def get_otc_upstream(request: Request) -> OtcUpstreamClient:
    client = getattr(request.app.state, "otc_upstream_client", None)
    if client is None:
        raise HTTPException(status_code=503, detail="OTC upstream not configured")
    return client


async def _proxy_post(
    request: Request,
    route: str,
    client: OtcUpstreamClient,
) -> Response:
    body = await request.body()
    try:
        upstream = await client.forward_post(
            route,
            body,
            content_type=request.headers.get("content-type"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return httpx_to_starlette_response(upstream)


def _as_float(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _build_order_snapshot(body: bytes, response: Response) -> dict[str, object] | None:
    try:
        request_payload = json.loads(body.decode("utf-8")) if body else {}
        response_payload = json.loads(response.body.decode("utf-8")) if response.body else {}
    except Exception:
        return None
    if not isinstance(request_payload, dict) or not isinstance(response_payload, dict):
        return None
    order_details = response_payload.get("order_details")
    if not isinstance(order_details, dict):
        return None
    order_id = str(order_details.get("order_id", "")).strip()
    if not order_id:
        return None
    pre_order = request_payload.get("pre_order")
    client_data = request_payload.get("client_data")
    payment_info = request_payload.get("payment_info")
    payment_data = order_details.get("payment_data")
    if not isinstance(pre_order, dict):
        pre_order = {}
    if not isinstance(client_data, dict):
        client_data = {}
    if not isinstance(payment_info, dict):
        payment_info = {}
    if not isinstance(payment_data, dict):
        payment_data = {}
    quote_total = _as_float(pre_order.get("amount_to_pay"))
    amount = _as_float(pre_order.get("final_amount_to_receive"))
    if amount is None:
        amount = _as_float(pre_order.get("total_amount_to_receive"))
    price = _as_float(pre_order.get("price"))
    trade_type = str(request_payload.get("trade_type", "BUY")).strip().upper()
    return {
        "id": order_id,
        "email": str(client_data.get("email", "")).strip(),
        "tradeSide": "sell" if trade_type == "SELL" else "buy",
        "asset": str(request_payload.get("asset", "")).strip(),
        "amount": amount or 0,
        "quoteTotal": quote_total or 0,
        "status": str(order_details.get("status", "waiting_for_payment")).strip() or "waiting_for_payment",
        "createdAt": int(time.time() * 1000),
        "price": price,
        "amountToPay": quote_total,
        "orderIsValid": bool(response_payload.get("order_is_valid", True)),
        "paymentData": {
            "BeneficiaryBankName": payment_data.get("BeneficiaryBankName"),
            "BeneficiaryName": payment_data.get("BeneficiaryName"),
            "BeneficiaryTaxId": payment_data.get("BeneficiaryTaxId"),
            "imagemQRCodeInBase64": payment_data.get("imagemQRCodeInBase64"),
            "payload": payment_data.get("payload") or payment_data.get("qr_code"),
            "txHash": payment_data.get("tx_hash"),
            "network": payment_data.get("network") or payment_info.get("network"),
            "walletAddress": payment_data.get("wallet_address") or payment_info.get("wallet"),
        },
    }


def _build_order_audit_data(body: bytes, response: Response) -> dict[str, object] | None:
    try:
        request_payload = json.loads(body.decode("utf-8")) if body else {}
        response_payload = json.loads(response.body.decode("utf-8")) if response.body else {}
    except Exception:
        return None
    if not isinstance(request_payload, dict) or not isinstance(response_payload, dict):
        return None
    client_data = request_payload.get("client_data")
    payment_info = request_payload.get("payment_info")
    pre_order = request_payload.get("pre_order")
    order_details = response_payload.get("order_details")
    if not isinstance(client_data, dict):
        client_data = {}
    if not isinstance(payment_info, dict):
        payment_info = {}
    if not isinstance(pre_order, dict):
        pre_order = {}
    if not isinstance(order_details, dict):
        order_details = {}
    return {
        "email": client_data.get("email"),
        "document": request_payload.get("document"),
        "document_type": request_payload.get("document_type"),
        "trade_type": request_payload.get("trade_type"),
        "asset": request_payload.get("asset"),
        "coupon": request_payload.get("coupon"),
        "price": pre_order.get("price") or request_payload.get("price"),
        "amount": pre_order.get("final_amount_to_receive") or pre_order.get("total_amount_to_receive"),
        "total": pre_order.get("amount_to_pay"),
        "client_id": request_payload.get("client_id"),
        "client_data": client_data,
        "payment_info": payment_info,
        "order_id": order_details.get("order_id"),
        "status": order_details.get("status"),
        "payment_data": order_details.get("payment_data"),
    }


def _extract_notification_client_context_from_body(body: bytes) -> tuple[str | None, str | None]:
    try:
        payload = json.loads(body.decode("utf-8")) if body else {}
    except Exception:
        return None, None
    if not isinstance(payload, dict):
        return None, None

    client_id = str(payload.get("client_id", "")).strip() or None
    email: str | None = None

    client_data = payload.get("client_data")
    if isinstance(client_data, dict):
        email = str(client_data.get("email", "")).strip() or str(client_data.get("id", "")).strip() or None

    if not email and client_id and "_webapp_" in client_id:
        email = client_id.split("_webapp_", 1)[0].strip() or None

    return email, client_id


def _inject_order_update_webhook(body: bytes, settings: Settings) -> bytes:
    if not settings.order_update_webhook_url:
        raise HTTPException(status_code=503, detail="order update webhook URL not configured")

    try:
        payload = json.loads(body.decode("utf-8")) if body else {}
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid create_order JSON payload") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid create_order payload")

    payload["webhook_url"] = settings.order_update_webhook_url

    return json.dumps(payload).encode("utf-8")

@router.post("/get_pricing")
async def otc_get_pricing(
    request: Request,
    client: Annotated[OtcUpstreamClient, Depends(get_otc_upstream)],
) -> Response:
    return await _proxy_post(request, "get_pricing", client)


@router.post("/pre_order_validation")
async def otc_pre_order_validation(
    request: Request,
    client: Annotated[OtcUpstreamClient, Depends(get_otc_upstream)],
) -> Response:
    return await _proxy_post(request, "pre_order_validation", client)

@router.post("/create_order")
async def otc_create_order(
    request: Request,
    client: Annotated[OtcUpstreamClient, Depends(get_otc_upstream)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    original_body = await request.body()
    body = _inject_order_update_webhook(original_body, settings)

    try:
        upstream = await client.forward_post(
            "create_order",
            body,
            content_type="application/json",
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    response = httpx_to_starlette_response(upstream)
    store = getattr(request.app.state, "order_store", None)
    if store is not None:
        snapshot = _build_order_snapshot(body, response)
        if snapshot is not None:
            store.save_order(snapshot)
    audit_data = _build_order_audit_data(body, response)
    if audit_data is not None:
        await write_audit_event(request, "order_created", audit_data)
    if upstream.status_code < 400 and response.body:
        try:
            response_payload = json.loads(response.body.decode("utf-8"))
            if isinstance(response_payload, dict):
                email, client_id = _extract_notification_client_context_from_body(original_body)
                await notify_order_created(
                    settings=settings,
                    response_body=response_payload,
                    email=email,
                    client_id=client_id,
                    redis_client=getattr(request.app.state, "redis", None),
                )
        except Exception:
            pass
    return response


@router.post("/counterparty_kyc")
async def otc_counterparty_kyc(
    request: Request,
    client: Annotated[OtcUpstreamClient, Depends(get_otc_upstream)],
) -> Response:
    return await _proxy_post(request, "counterparty_kyc", client)


@router.post("/get_available_withdraw_networks")
async def otc_get_available_withdraw_networks(
    request: Request,
    client: Annotated[OtcUpstreamClient, Depends(get_otc_upstream)],
) -> Response:
    return await _proxy_post(request, "get_available_withdraw_networks", client)


@router.post("/check_wallet_risk")
async def otc_check_wallet_risk(
    request: Request,
    client: Annotated[OtcUpstreamClient, Depends(get_otc_upstream)],
) -> Response:
    return await _proxy_post(request, "check_wallet_risk", client)


@router.post("/get_transaction_history")
async def otc_get_transaction_history(
    request: Request,
    client: Annotated[OtcUpstreamClient, Depends(get_otc_upstream)],
) -> Response:
    return await _proxy_post(request, "get_transaction_history", client)


@router.post("/get_counterparty_transactional_limit")
async def otc_get_counterparty_transactional_limit(
    request: Request,
    client: Annotated[OtcUpstreamClient, Depends(get_otc_upstream)],
) -> Response:
    return await _proxy_post(request, "get_counterparty_transactional_limit", client)
