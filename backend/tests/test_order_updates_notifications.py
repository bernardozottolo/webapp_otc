from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.notifications.order_notifications import (
    EVENT_UPDATE_EXTERNAL,
    EVENT_UPDATE_LOCAL,
    build_notification_dedup_identity,
)
from backend.order_store import InMemoryOrderStore
from backend.routes.order_updates import get_order_updates, receive_order_update

CANCELLED_UPDATE = {
    "template": "payment_timeout",
    "order_info": {
        "order_id": "order-cancelled-1",
        "status": "cancelled",
    },
}


def _mock_request() -> MagicMock:
    request = MagicMock()
    request.state.request_id = "test-request-id"
    request.headers = {}
    request.url.path = "/api/order-updates/order-cancelled-1"
    request.url.query = ""
    request.url.__str__ = lambda: "http://testserver/api/order-updates/order-cancelled-1"
    request.path_params = {"order_id": "order-cancelled-1"}
    request.app.state.redis = None
    request.app.state.settings = MagicMock(redis_url="")
    return request


class NotificationDedupIdentityTests(unittest.TestCase):
    def test_external_update_identity_is_stable_across_repeats(self) -> None:
        first = build_notification_dedup_identity(
            order_id="order-cancelled-1",
            event=EVENT_UPDATE_EXTERNAL,
            update_body=CANCELLED_UPDATE,
        )
        second = build_notification_dedup_identity(
            order_id="order-cancelled-1",
            event=EVENT_UPDATE_EXTERNAL,
            update_body=CANCELLED_UPDATE,
        )
        self.assertEqual(first, second)

    def test_local_payload_ignores_detected_at_ms(self) -> None:
        first = build_notification_dedup_identity(
            order_id="order-cancelled-1",
            event=EVENT_UPDATE_LOCAL,
            local_payload={"reason": "payment_timeout", "detected_at_ms": 1_700_000_000_000},
            status="cancelled",
        )
        second = build_notification_dedup_identity(
            order_id="order-cancelled-1",
            event=EVENT_UPDATE_LOCAL,
            local_payload={"reason": "payment_timeout", "detected_at_ms": 1_700_000_099_999},
            status="cancelled",
        )
        self.assertEqual(first, second)

    def test_external_and_local_timeout_share_identity(self) -> None:
        external = build_notification_dedup_identity(
            order_id="order-cancelled-1",
            event=EVENT_UPDATE_EXTERNAL,
            update_body=CANCELLED_UPDATE,
        )
        local = build_notification_dedup_identity(
            order_id="order-cancelled-1",
            event=EVENT_UPDATE_LOCAL,
            local_payload={"reason": "payment_timeout", "detected_at_ms": 123},
            status="cancelled",
        )
        self.assertEqual(external, local)

    def test_concluded_updates_differ_by_tx_hash(self) -> None:
        first = build_notification_dedup_identity(
            order_id="order-1",
            event=EVENT_UPDATE_EXTERNAL,
            update_body={
                "template": "order_concluded",
                "order_info": {
                    "order_id": "order-1",
                    "status": "concluded",
                    "payment_data_v2": {"payout_identifier": "0xabc"},
                },
            },
        )
        second = build_notification_dedup_identity(
            order_id="order-1",
            event=EVENT_UPDATE_EXTERNAL,
            update_body={
                "template": "order_concluded",
                "order_info": {
                    "order_id": "order-1",
                    "status": "concluded",
                    "payment_data_v2": {"payout_identifier": "0xdef"},
                },
            },
        )
        self.assertNotEqual(first["tx_hash"], second["tx_hash"])


class OrderUpdatesGetReadOnlyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.store = InMemoryOrderStore(3_600_000)
        await self.store.save_order(
            {
                "id": "order-cancelled-1",
                "email": "user@example.com",
                "status": "cancelled",
                "tradeSide": "buy",
                "asset": "USDT",
                "amount": 100,
                "quoteTotal": 500,
                "createdAt": 1_700_000_000_000,
            }
        )
        await self.store.add_update(CANCELLED_UPDATE)
        self.request = _mock_request()

    @patch("backend.routes.order_updates.notify_order_update", new_callable=AsyncMock)
    async def test_get_does_not_call_notify_order_update(self, mock_notify: AsyncMock) -> None:
        for _ in range(5):
            record = await get_order_updates("order-cancelled-1", self.request, self.store)
            self.assertEqual(record["order_id"], "order-cancelled-1")

        mock_notify.assert_not_called()

    @patch("backend.routes.order_updates.write_audit_event", new_callable=AsyncMock)
    @patch("backend.routes.order_updates.notify_order_update", new_callable=AsyncMock)
    async def test_post_still_calls_notify_order_update(
        self,
        mock_notify: AsyncMock,
        _mock_audit: AsyncMock,
    ) -> None:
        settings = MagicMock()
        settings.redis_url = ""
        self.request.app.state.settings = settings

        result = await receive_order_update(CANCELLED_UPDATE, self.request, settings, self.store)
        self.assertTrue(result["success"])
        mock_notify.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
