from __future__ import annotations

import json
import logging
from typing import Any

from ..clients_database_client import ClientsDatabaseUpstreamClient
from .store import BiometryPendingRecord

logger = logging.getLogger("didit_proxy.biometry_pending.executors")

BANK_KEY_TYPE_TO_NETWORK = {
    "Telefone": "phone",
    "Email": "email",
    "Documento": "document",
    "Aleatoria": "random",
}


def _normalize_email(email: str) -> str:
    return email.strip().lower()


async def _post_clients_database(client: ClientsDatabaseUpstreamClient, payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    response = await client.forward_post(body, content_type="application/json")
    if response.status_code >= 400:
        text = response.text[:500] if response.text else ""
        raise RuntimeError(f"clients_database failed ({response.status_code}): {text}")
    try:
        parsed = response.json()
    except Exception as exc:
        raise RuntimeError("clients_database returned invalid JSON") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("clients_database returned unexpected payload")
    return parsed


async def execute_onboarding(
    client: ClientsDatabaseUpstreamClient,
    record: BiometryPendingRecord,
    *,
    approved_at_ms: int,
) -> None:
    payload = record.action_payload
    email = _normalize_email(str(payload.get("email") or record.email))
    document_number = str(payload.get("document_number") or payload.get("documentNumber") or "").strip()
    person_type = str(payload.get("person_type") or payload.get("personType") or "").strip()
    if not document_number or not person_type:
        raise RuntimeError("onboarding payload missing document or person_type")

    data = {
        "document": document_number,
        "birth_date": payload.get("birth_date") or payload.get("birthDate"),
        "email": email,
        "approved_kyc_result": payload.get("approved_kyc_result") or payload.get("approvedKycResult"),
        "kyc_date": payload.get("kyc_date") or payload.get("kycDate"),
        "person_type": person_type,
        "kyc_name": payload.get("kyc_name") or payload.get("kycName"),
        "last_successful_biometric": approved_at_ms,
        "email_verified": True,
        "email_pending_verification": None,
        "transactional_limit": None,
        "waiting_response": None,
        "waiting_url": None,
    }

    existing = await _post_clients_database(
        client,
        {
            "action": "query",
            "table": "clients",
            "primary_keys": {
                "id": email,
                "platform": record.platform,
                "country": record.company_key,
            },
        },
    )
    has_client = bool(existing.get("success")) and bool(existing.get("data"))

    if has_client:
        await _post_clients_database(
            client,
            {
                "action": "update",
                "table": "clients",
                "primary_keys": {
                    "id": email,
                    "platform": record.platform,
                    "country": record.company_key,
                },
                "data": data,
            },
        )
    else:
        await _post_clients_database(
            client,
            {
                "action": "insert",
                "table": "clients",
                "data": {
                    "id": email,
                    "platform": record.platform,
                    "country": record.company_key,
                    **data,
                },
            },
        )


async def execute_wallet_save(
    client: ClientsDatabaseUpstreamClient,
    record: BiometryPendingRecord,
    *,
    approved_at_ms: int,
    local_payment_asset_by_country: dict[str, str],
) -> None:
    payload = record.action_payload
    payment = payload.get("payment_data") or payload.get("paymentData")
    if not isinstance(payment, dict):
        raise RuntimeError("wallet_save payload missing payment_data")

    email = _normalize_email(str(payment.get("email") or record.email))
    trade_side = str(payment.get("trade_side") or payment.get("tradeSide") or "buy")
    asset = str(payment.get("asset") or record.asset or "").strip().upper()
    country = str(payment.get("country") or record.company_key)
    kind = str(payment.get("kind") or "crypto")

    await _post_clients_database(
        client,
        {
            "action": "update",
            "table": "clients",
            "primary_keys": {
                "id": email,
                "platform": record.platform,
                "country": record.company_key,
            },
            "data": {"last_successful_biometric": approved_at_ms},
        },
    )

    storage_asset = asset
    if trade_side != "buy":
        storage_asset = local_payment_asset_by_country.get(country, asset)

    if kind == "crypto":
        wallet_payload = {
            "asset": storage_asset,
            "address": str(payment.get("wallet_address") or payment.get("walletAddress") or "").strip(),
            "network": str(payment.get("network") or "").strip(),
        }
    else:
        bank_key_type = str(payment.get("bank_key_type") or payment.get("bankKeyType") or "Telefone")
        wallet_payload = {
            "asset": storage_asset,
            "address": str(payment.get("bank_key_value") or payment.get("bankKeyValue") or "").strip(),
            "network": BANK_KEY_TYPE_TO_NETWORK.get(bank_key_type, bank_key_type.lower()),
        }

    existing_wallet = await _post_clients_database(
        client,
        {
            "action": "query",
            "table": "wallet",
            "primary_keys": {
                "id": email,
                "platform": record.platform,
                "country": record.company_key,
                "asset": storage_asset,
            },
        },
    )
    has_wallet = bool(existing_wallet.get("success")) and bool(existing_wallet.get("data"))

    if has_wallet:
        await _post_clients_database(
            client,
            {
                "action": "update",
                "table": "wallet",
                "primary_keys": {
                    "id": email,
                    "platform": record.platform,
                    "country": record.company_key,
                    "asset": storage_asset,
                },
                "data": wallet_payload,
            },
        )
    else:
        await _post_clients_database(
            client,
            {
                "action": "insert",
                "table": "wallet",
                "data": {
                    "id": email,
                    "platform": record.platform,
                    "country": record.company_key,
                    **wallet_payload,
                },
            },
        )
