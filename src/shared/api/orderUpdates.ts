import type { StoredOrderRecord, Order, OrderUpdatePayload } from "../types";

export interface OrderUpdatesConfig {
  orderBaseUrl: string;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function buildOrderUpdatesUrl(baseUrl: string, orderId: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  const path = `/api/order-updates/${encodeURIComponent(orderId)}`;
  return normalized ? `${normalized}${path}` : path;
}

function mapOrderUpdatePayload(value: unknown): OrderUpdatePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const rawOrderInfo = raw.order_info;
  if (!rawOrderInfo || typeof rawOrderInfo !== "object" || Array.isArray(rawOrderInfo)) {
    return null;
  }
  const orderInfo = rawOrderInfo as Record<string, unknown>;
  const paymentData = orderInfo.payment_data;
  return {
    template: asString(raw.template),
    clientId: asString(raw.client_id) || undefined,
    orderInfo: {
      order_id: asString(orderInfo.order_id),
      status: asString(orderInfo.status) || undefined,
      price: orderInfo.price == null ? undefined : asNumber(orderInfo.price),
      amount_to_pay: orderInfo.amount_to_pay == null ? undefined : asNumber(orderInfo.amount_to_pay),
      total_amount_to_receive:
        orderInfo.total_amount_to_receive == null ? undefined : asNumber(orderInfo.total_amount_to_receive),
      fee: orderInfo.fee == null ? undefined : asNumber(orderInfo.fee),
      final_amount_to_receive:
        orderInfo.final_amount_to_receive == null ? undefined : asNumber(orderInfo.final_amount_to_receive),
      payment_data:
        paymentData && typeof paymentData === "object" && !Array.isArray(paymentData)
          ? {
              qr_code: asString((paymentData as Record<string, unknown>).qr_code) || undefined,
              tx_hash:
                (paymentData as Record<string, unknown>).tx_hash == null
                  ? undefined
                  : ((paymentData as Record<string, unknown>).tx_hash as string | null),
              tx_hash_url:
                (paymentData as Record<string, unknown>).tx_hash_url == null
                  ? undefined
                  : ((paymentData as Record<string, unknown>).tx_hash_url as string | null),
              network: asString((paymentData as Record<string, unknown>).network) || undefined,
              wallet_address: asString((paymentData as Record<string, unknown>).wallet_address) || undefined
            }
          : undefined
    },
    receivedAt: asNumber(raw.received_at, Date.now())
  };
}

function mapStoredOrderRecord(value: unknown): StoredOrderRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const order = raw.order as Order | undefined;
  if (!order || typeof order !== "object" || !asString((order as Order).id)) {
    return null;
  }
  const updatesRaw = Array.isArray(raw.updates) ? raw.updates : [];
  const updates = updatesRaw.map(mapOrderUpdatePayload).filter((item): item is OrderUpdatePayload => item != null);
  const createdAt = asNumber(raw.created_at, asNumber((order as Order).createdAt, Date.now()));
  const expiresAt = asNumber(raw.expires_at, createdAt);
  const lastUpdatedAt = asNumber(raw.last_updated_at, createdAt);
  return {
    order,
    createdAt,
    expiresAt,
    updates,
    lastUpdatedAt
  };
}

export async function getOrderRecordHttp(config: OrderUpdatesConfig, orderId: string): Promise<StoredOrderRecord | null> {
  const response = await fetch(buildOrderUpdatesUrl(config.orderBaseUrl, orderId), {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `order updates failed with status ${response.status}`);
  }
  return mapStoredOrderRecord(await response.json());
}
