from __future__ import annotations

import re
from typing import Literal

DiditVerificationType = Literal["document_verification", "biometric_validation"]
DiditPendingAction = Literal["onboarding", "wallet_save"]

REGISTER_CLIENT_ACTION = "register_client"


def normalize_document_number(document_number: str) -> str:
    return re.sub(r"\D", "", document_number.strip())


def resolve_didit_action(*, action: DiditPendingAction, asset: str | None = None) -> str:
    if action == "onboarding":
        return REGISTER_CLIENT_ACTION
    normalized_asset = (asset or "").strip().upper()
    if not normalized_asset:
        raise ValueError("asset is required for wallet_save Didit action")
    return f"register_wallet_{normalized_asset}"


def resolve_didit_action_for_flow(
    *,
    action: DiditPendingAction,
    verification_type: DiditVerificationType,
    asset: str | None = None,
) -> str:
    if verification_type == "document_verification":
        return REGISTER_CLIENT_ACTION
    return resolve_didit_action(action=action, asset=asset)


def build_didit_vendor_data(
    document_number: str,
    verification_type: DiditVerificationType,
    *,
    action: DiditPendingAction,
    asset: str | None = None,
) -> str:
    normalized_document = normalize_document_number(document_number)
    if not normalized_document:
        raise ValueError("document_number is required")
    action_slug = resolve_didit_action_for_flow(
        action=action,
        verification_type=verification_type,
        asset=asset,
    )
    return f"{normalized_document}_{verification_type}_{action_slug}"


def build_didit_search(
    document_number: str,
    verification_type: DiditVerificationType,
    *,
    action: DiditPendingAction,
    asset: str | None = None,
) -> str:
    return build_didit_vendor_data(
        document_number,
        verification_type,
        action=action,
        asset=asset,
    )


def is_biometric_vendor_data(vendor_data: str) -> bool:
    normalized = vendor_data.strip()
    if "_biometric_validation_" in normalized:
        return True
    return normalized.endswith("_biometric_validation")


def is_document_vendor_data(vendor_data: str) -> bool:
    normalized = vendor_data.strip()
    if "_document_verification_" in normalized:
        return True
    return normalized.endswith("_document_verification")
