from __future__ import annotations

from typing import Any


def wallet_info_from_payment(payment: Any) -> dict[str, str] | None:
    if not isinstance(payment, dict):
        return None

    asset = str(payment.get("asset") or "").strip().upper()
    if not asset:
        return None

    kind = str(payment.get("kind") or "crypto")
    if kind == "crypto":
        wallet = str(payment.get("wallet_address") or payment.get("walletAddress") or "").strip()
        network = str(payment.get("network") or "").strip()
    else:
        wallet = str(payment.get("bank_key_value") or payment.get("bankKeyValue") or "").strip()
        network = str(payment.get("bank_key_type") or payment.get("bankKeyType") or "").strip()

    if not wallet:
        return None

    return {
        "asset": asset,
        "wallet": wallet,
        "network": network,
    }
