import type { OrderPaymentData, StoredOrderRecord, Order, OrderUpdatePayload } from "../types";
import type { OrderCreateSummary, TradeSide } from "../types";

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

function asOptionalString(value: unknown): string | undefined {
  const parsed = asString(value).trim();
  return parsed || undefined;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return asString(value) || null;
}

function mapPaymentInstructions(value: unknown): OrderPaymentData | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const src = value as Record<string, unknown>;
  const result: OrderPaymentData = {};

  const beneficiaryBankName = asOptionalString(src.BeneficiaryBankName);
  const beneficiaryName = asOptionalString(src.BeneficiaryName);
  const beneficiaryTaxId = asOptionalString(src.BeneficiaryTaxId);
  const imagemQRCodeInBase64 = asOptionalString(src.imagemQRCodeInBase64);
  const payload = asOptionalString(src.payload) || asOptionalString(src.qr_code);
  const network = asOptionalString(src.network);
  const walletAddress = asOptionalString(src.wallet_address) || asOptionalString(src.walletAddress);
  const pixKey = asOptionalString(src.pix_key) || asOptionalString(src.pixKey);

  if (beneficiaryBankName) result.BeneficiaryBankName = beneficiaryBankName;
  if (beneficiaryName) result.BeneficiaryName = beneficiaryName;
  if (beneficiaryTaxId) result.BeneficiaryTaxId = beneficiaryTaxId;
  if (imagemQRCodeInBase64) result.imagemQRCodeInBase64 = imagemQRCodeInBase64;
  if (payload) result.payload = payload;
  if (network) result.network = network;
  if (walletAddress) result.walletAddress = walletAddress;
  if (pixKey) result.pixKey = pixKey;

  if (src.tx_hash !== undefined) {
    result.txHash = asNullableString(src.tx_hash);
  }
  if (src.tx_hash_url !== undefined) {
    result.txHashUrl = asNullableString(src.tx_hash_url);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function mapPaymentDataV2(value: unknown): OrderUpdatePayload["orderInfo"]["payment_data_v2"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const src = value as Record<string, unknown>;
  let payoutIdentifier = src.payout_identifier;
  let refundIdentifier = src.refund_identifier;
  const systemInfo = src.system_payment_info;
  if (systemInfo && typeof systemInfo === "object" && !Array.isArray(systemInfo)) {
    const system = systemInfo as Record<string, unknown>;
    if (payoutIdentifier === undefined) {
      payoutIdentifier = system.payout_identifier;
    }
    if (refundIdentifier === undefined) {
      refundIdentifier = system.refund_identifier;
    }
  }
  if (payoutIdentifier === undefined && refundIdentifier === undefined) {
    return undefined;
  }
  return {
    payout_identifier: payoutIdentifier === undefined ? undefined : asNullableString(payoutIdentifier),
    refund_identifier: refundIdentifier === undefined ? undefined : asNullableString(refundIdentifier)
  };
}

function asTradeSide(value: unknown): TradeSide | undefined {
  const normalized = asString(value).trim().toLowerCase();
  if (normalized === "buy" || normalized === "sell") {
    return normalized;
  }
  return undefined;
}

function mapOrderCreateSummary(value: unknown): OrderCreateSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const src = value as Record<string, unknown>;
  const tradeSide = asTradeSide(src.tradeSide ?? src.trade_side);
  if (!tradeSide) {
    return undefined;
  }
  const rawCustomerPayment = src.customerPayment ?? src.customer_payment;
  const customerPayment =
    rawCustomerPayment && typeof rawCustomerPayment === "object" && !Array.isArray(rawCustomerPayment)
      ? (rawCustomerPayment as Record<string, unknown>)
      : {};
  return {
    tradeSide,
    asset: asString(src.asset),
    amount: asNumber(src.amount),
    amountToPay: asNumber(src.amountToPay ?? src.amount_to_pay),
    inputAsset: asOptionalString(src.inputAsset ?? src.input_asset),
    outputAsset: asOptionalString(src.outputAsset ?? src.output_asset),
    price: src.price == null ? undefined : asNumber(src.price),
    payViaNetworkCode: asOptionalString(src.payViaNetworkCode ?? src.pay_via_network_code),
    payViaNetworkLabel: asOptionalString(src.payViaNetworkLabel ?? src.pay_via_network_label),
    payViaNetwork: asOptionalString(src.payViaNetwork ?? src.pay_via_network),
    customerDocument: asOptionalString(src.customerDocument ?? src.customer_document),
    customerDocumentType: asOptionalString(src.customerDocumentType ?? src.customer_document_type),
    customerPayment: {
      network: asOptionalString(customerPayment.network),
      walletAddress: asOptionalString(customerPayment.walletAddress ?? customerPayment.wallet_address),
      pixKey: asOptionalString(customerPayment.pixKey ?? customerPayment.pix_key),
      pixKeyType: asOptionalString(customerPayment.pixKeyType ?? customerPayment.pix_key_type)
    }
  };
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
  return {
    template: asString(raw.template),
    clientId: asString(raw.client_id) || undefined,
    orderInfo: {
      order_id: asString(orderInfo.order_id),
      trade_type: asOptionalString(orderInfo.trade_type),
      asset: asOptionalString(orderInfo.asset),
      status: asString(orderInfo.status) || undefined,
      price: orderInfo.price == null ? undefined : asNumber(orderInfo.price),
      input_asset: asOptionalString(orderInfo.input_asset),
      input_amount:
        orderInfo.input_amount == null
          ? orderInfo.amount_to_pay == null
            ? undefined
            : asNumber(orderInfo.amount_to_pay)
          : asNumber(orderInfo.input_amount),
      amount_to_pay: orderInfo.amount_to_pay == null ? undefined : asNumber(orderInfo.amount_to_pay),
      output_asset: asOptionalString(orderInfo.output_asset),
      output_amount_gross:
        orderInfo.output_amount_gross == null ? undefined : asNumber(orderInfo.output_amount_gross),
      output_amount_net: orderInfo.output_amount_net == null ? undefined : asNumber(orderInfo.output_amount_net),
      fee_asset: orderInfo.fee_asset == null ? undefined : asNumber(orderInfo.fee_asset),
      fee_fiat: orderInfo.fee_fiat == null ? undefined : asNumber(orderInfo.fee_fiat),
      payment_instructions: mapPaymentInstructions(orderInfo.payment_instructions),
      payment_data_v2: mapPaymentDataV2(orderInfo.payment_data_v2)
    },
    receivedAt: asNumber(raw.received_at, Date.now())
  };
}

function createOrderShell(orderId: string, createdAt: number): Order {
  return {
    id: orderId,
    email: "",
    tradeSide: "buy",
    asset: "",
    amount: 0,
    quoteTotal: 0,
    status: "waiting_for_payment",
    createdAt
  };
}

function mapStoredOrderRecord(value: unknown): StoredOrderRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const remoteOrder = raw.order;
  const updatesRaw = Array.isArray(raw.updates) ? raw.updates : [];
  const updates = updatesRaw.map(mapOrderUpdatePayload).filter((item): item is OrderUpdatePayload => item != null);
  const orderId =
    asString(raw.order_id) ||
    (remoteOrder && typeof remoteOrder === "object" && !Array.isArray(remoteOrder)
      ? asString((remoteOrder as Order).id)
      : "") ||
    asString(updates[0]?.orderInfo.order_id);
  if (!orderId) {
    return null;
  }
  const createdAt = asNumber(
    raw.created_at,
    remoteOrder && typeof remoteOrder === "object" && !Array.isArray(remoteOrder)
      ? asNumber((remoteOrder as Order).createdAt, Date.now())
      : updates[0]?.receivedAt ?? Date.now()
  );
  const expiresAt = asNumber(raw.expires_at, createdAt);
  const lastUpdatedAt = asNumber(raw.last_updated_at, createdAt);
  const order =
    remoteOrder && typeof remoteOrder === "object" && !Array.isArray(remoteOrder) && asString((remoteOrder as Order).id)
      ? (remoteOrder as Order)
      : createOrderShell(orderId, createdAt);
  return {
    order,
    createSummary: mapOrderCreateSummary(raw.createSummary ?? raw.create_summary),
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
