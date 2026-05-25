from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from ..config import Settings

logger = logging.getLogger("didit_proxy.biometry_pending.email")


async def send_biometry_notification_email(
    settings: Settings,
    *,
    email: str,
    message_type: str,
    company_key: str,
    platform: str,
    client_data: dict[str, Any] | None = None,
) -> None:
    if not settings.send_email_url:
        logger.warning("send_email_url not configured; skipping biometry notification (%s)", message_type)
        return

    normalized_email = email.strip().lower()
    payload: dict[str, Any] = {
        "platform": platform,
        "id": normalized_email,
        "country": company_key,
        "message_type": message_type,
        "email": normalized_email,
        "client_data": client_data or {},
    }
    if company_key:
        payload["company_key"] = company_key

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                settings.send_email_url,
                content=body,
                headers={"content-type": "application/json"},
            )
        if response.status_code >= 400:
            logger.warning(
                "Biometry notification email failed (%s) status=%s body=%s",
                message_type,
                response.status_code,
                response.text[:300],
            )
    except Exception as exc:
        logger.warning("Biometry notification email error (%s): %s", message_type, exc)
