from __future__ import annotations

import logging
import time
from typing import Any, Literal

from fastapi import HTTPException
from redis.asyncio import Redis

from ..clients_database_client import ClientsDatabaseUpstreamClient
from ..config import BiometryReviewSettings, Settings, _load_runtime_json, _repo_root
from ..didit_client import DiditClient
from ..didit_vendor_data import build_didit_search
from .email_notify import send_biometry_notification_email
from .executors import execute_onboarding, execute_wallet_save
from .store import BiometryPendingAction, BiometryPendingRecord, BiometryPendingStore

logger = logging.getLogger("didit_proxy.biometry_pending.service")

WAIT_STATUSES = frozenset({"In Review", "Pending", "In Progress"})
DIDIT_WAIT_STATUSES = ("In Review", "Pending", "In Progress")
APPROVED_STATUSES = frozenset({"Approved"})
DECLINED_STATUSES = frozenset({"Declined", "Abandoned", "Expired", "Kyc Expired"})


class _ImmediateApprovalRecord:
    """Stand-in for _email_message_type when the session was approved without Redis pending."""

    def __init__(self, action: BiometryPendingAction) -> None:
        self.action = action


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _load_local_payment_assets(settings: Settings) -> dict[str, str]:
    raw = _load_runtime_json(_repo_root(), "")
    if not raw:
        return {"BR": "PIX"}
    backend = raw.get("backend")
    if not isinstance(backend, dict):
        return {"BR": "PIX"}
    mapping = backend.get("localPaymentAssetByCountry")
    if not isinstance(mapping, dict):
        return {"BR": "PIX"}
    return {str(key): str(value) for key, value in mapping.items() if str(value).strip()}


class BiometryPendingService:
    def __init__(
        self,
        *,
        redis_client: Redis,
        settings: Settings,
        didit_client: DiditClient,
        clients_db_client: ClientsDatabaseUpstreamClient | None,
    ) -> None:
        if redis_client is None:
            raise HTTPException(status_code=503, detail="Redis unavailable; configure REDIS_URL")
        self._settings = settings
        self._review: BiometryReviewSettings = settings.biometry_review
        self._store = BiometryPendingStore(redis_client, ttl_hours=settings.biometry_pending_ttl_hours)
        self._didit = didit_client
        self._clients_db = clients_db_client
        self._local_payment_assets = _load_local_payment_assets(settings)

    @property
    def review_settings(self) -> BiometryReviewSettings:
        return self._review

    def _blocked_response(
        self,
        *,
        action: BiometryPendingAction,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        message = (
            self._review.duplicate_onboarding_message
            if action == "onboarding"
            else self._review.duplicate_wallet_message
        )
        payload: dict[str, Any] = {"blocked": True, "message": message}
        if session_id:
            payload["sessionId"] = session_id
        return payload

    async def _has_didit_waiting_session(
        self,
        *,
        document_number: str,
        action: BiometryPendingAction,
        asset: str | None = None,
    ) -> str | None:
        normalized_asset = asset.strip().upper() if asset else None
        search = build_didit_search(
            document_number,
            "biometric_validation",
            action=action,
            asset=normalized_asset,
        )
        for wait_status in DIDIT_WAIT_STATUSES:
            try:
                payload = await self._didit.list_sessions(search=search, status=wait_status, limit=1)
            except Exception as exc:
                logger.warning("Didit list_sessions failed for search=%s status=%s: %s", search, wait_status, exc)
                continue
            results = payload.get("results", [])
            if not isinstance(results, list) or not results:
                continue
            first = results[0]
            if not isinstance(first, dict):
                continue
            session_id = first.get("session_id") or first.get("sessionId")
            if isinstance(session_id, str) and session_id.strip():
                return session_id.strip()
        return None

    async def check_blocked(
        self,
        *,
        action: BiometryPendingAction,
        email: str,
        asset: str | None = None,
        document_number: str | None = None,
    ) -> dict[str, Any]:
        normalized_email = _normalize_email(email)
        normalized_asset = asset.strip().upper() if asset else None
        existing_session_id = await self._store.get_dedup_session_id(
            action=action,
            email=normalized_email,
            asset=normalized_asset,
        )
        if existing_session_id:
            return self._blocked_response(action=action, session_id=existing_session_id)

        if document_number and document_number.strip():
            didit_session_id = await self._has_didit_waiting_session(
                document_number=document_number,
                action=action,
                asset=normalized_asset,
            )
            if didit_session_id:
                return self._blocked_response(action=action, session_id=didit_session_id)

        return {"blocked": False}

    async def register(
        self,
        *,
        session_id: str,
        session_status: str,
        action: BiometryPendingAction,
        email: str,
        asset: str | None,
        action_payload: dict[str, Any],
    ) -> dict[str, Any]:
        if session_status != "In Review":
            raise HTTPException(status_code=400, detail="Only In Review sessions can be registered")

        normalized_email = _normalize_email(email)
        normalized_asset = asset.strip().upper() if asset else None

        blocked = await self.check_blocked(action=action, email=normalized_email, asset=normalized_asset)
        if blocked.get("blocked"):
            raise HTTPException(status_code=409, detail=str(blocked.get("message") or "Biometry already pending"))

        now_ms = int(time.time() * 1000)
        ttl_ms = self._settings.biometry_pending_ttl_hours * 3600 * 1000
        record = BiometryPendingRecord(
            session_id=session_id.strip(),
            status=session_status,
            action=action,
            email=normalized_email,
            asset=normalized_asset,
            company_key=self._settings.backend_company_key,
            platform=self._settings.backend_platform,
            created_at_ms=now_ms,
            expires_at_ms=now_ms + ttl_ms,
            last_polled_at_ms=None,
            action_payload=action_payload,
        )
        await self._store.save(record)
        return {
            "ok": True,
            "sessionId": record.session_id,
            "message": self._review.pending_user_message,
        }

    def _email_message_type(
        self,
        record: BiometryPendingRecord,
        outcome: Literal["approved", "declined", "expired"],
    ) -> str:
        if record.action == "onboarding":
            if outcome == "approved":
                return self._review.email_message_type_approved_onboarding
            if outcome == "declined":
                return self._review.email_message_type_declined_onboarding
            return self._review.email_message_type_expired_onboarding
        if outcome == "approved":
            return self._review.email_message_type_approved_wallet
        if outcome == "declined":
            return self._review.email_message_type_declined_wallet
        return self._review.email_message_type_expired_wallet

    async def _execute_approved(self, record: BiometryPendingRecord, *, approved_at_ms: int) -> None:
        if self._clients_db is None:
            raise RuntimeError("clients_database upstream not configured")
        if record.action == "onboarding":
            await execute_onboarding(self._clients_db, record, approved_at_ms=approved_at_ms)
        else:
            await execute_wallet_save(
                self._clients_db,
                record,
                approved_at_ms=approved_at_ms,
                local_payment_asset_by_country=self._local_payment_assets,
            )

    async def process_session(self, session_id: str) -> str | None:
        """Returns outcome label when finished: approved | declined | expired | None if still waiting."""
        record = await self._store.get(session_id)
        if record is None:
            await self._store.list_session_ids()  # noop trigger
            return None

        now_ms = int(time.time() * 1000)
        if now_ms >= record.expires_at_ms:
            try:
                await self._didit.update_session_status(
                    record.session_id,
                    new_status="Declined",
                    comment="TTL expired while pending manual review",
                )
            except Exception as exc:
                logger.warning("Didit decline on TTL failed for %s: %s", session_id, exc)
            await send_biometry_notification_email(
                self._settings,
                email=record.email,
                message_type=self._email_message_type(record, "expired"),
                company_key=record.company_key,
                platform=record.platform,
                client_data={"session_id": record.session_id, "action": record.action},
            )
            await self._store.remove(record)
            return "expired"

        await self._store.update_last_polled(session_id)

        try:
            decision = await self._didit.get_session_decision(session_id)
        except Exception as exc:
            logger.warning("Didit decision poll failed for %s: %s", session_id, exc)
            return None

        status = str(decision.get("status") or "").strip()
        if status in WAIT_STATUSES:
            return None

        if status in APPROVED_STATUSES:
            approved_at_ms = int(time.time() * 1000)
            try:
                await self._execute_approved(record, approved_at_ms=approved_at_ms)
            except Exception as exc:
                logger.exception("Failed to execute approved biometry action %s: %s", session_id, exc)
                return None
            await send_biometry_notification_email(
                self._settings,
                email=record.email,
                message_type=self._email_message_type(record, "approved"),
                company_key=record.company_key,
                platform=record.platform,
                client_data={"session_id": record.session_id, "action": record.action},
            )
            await self._store.remove(record)
            return "approved"

        if status in DECLINED_STATUSES or status:
            await send_biometry_notification_email(
                self._settings,
                email=record.email,
                message_type=self._email_message_type(record, "declined"),
                company_key=record.company_key,
                platform=record.platform,
                client_data={"session_id": record.session_id, "action": record.action, "status": status},
            )
            await self._store.remove(record)
            return "declined"

        return None

    async def notify_immediate_approval(
        self,
        *,
        action: BiometryPendingAction,
        email: str,
        asset: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        """Send approval email when Didit approves in-session (no In Review polling path)."""
        normalized_email = _normalize_email(email)
        client_data: dict[str, Any] = {"action": action, "immediate": True}
        if session_id and session_id.strip():
            client_data["session_id"] = session_id.strip()
        if asset and asset.strip():
            client_data["asset"] = asset.strip().upper()

        stub = _ImmediateApprovalRecord(action)
        message_type = self._email_message_type(stub, "approved")
        await send_biometry_notification_email(
            self._settings,
            email=normalized_email,
            message_type=message_type,
            company_key=self._settings.backend_company_key,
            platform=self._settings.backend_platform,
            client_data=client_data,
        )
        return {"ok": True, "messageType": message_type}

    async def poll_all(self) -> dict[str, int]:
        counts = {"approved": 0, "declined": 0, "expired": 0, "waiting": 0, "errors": 0}
        for session_id in await self._store.list_session_ids():
            try:
                outcome = await self.process_session(session_id)
            except Exception:
                logger.exception("Unexpected error polling biometry session %s", session_id)
                counts["errors"] += 1
                continue
            if outcome is None:
                counts["waiting"] += 1
            elif outcome in counts:
                counts[outcome] += 1
        return counts
