import type {
  BuyCreateOrderInput,
  CreateOrderInput,
  KycSubmitPayload,
  KycSubmitResult,
  OtcKycInfoPayload,
  PreOrderValidationInput,
  SellCreateOrderInput
} from "./contracts";
import { buildCreateOrderSummaryFromInput } from "./orderCreateSummary";
import { cacheOrder, getCachedOrder } from "./orderCache";
import type { PricingConfig } from "./pricing";
import type { OtcPixKeyOwnerCheck, OtcPreOrderValidation, OtcWalletRiskCheck, OtcWithdrawNetwork, Order } from "../types";
import { resolveSameOriginOtcPath } from "./otcUrls";

interface OtcEnvelope<T> {
  success?: boolean;
  data?: T;
  message?: string;
  error?: string;
}

interface CounterpartyKycPayload {
  birth_date?: unknown;
  company_name?: unknown;
  document?: unknown;
  document_type?: unknown;
  full_name?: unknown;
  kyc_result?: unknown;
  failure_reasons?: unknown;
  owners_info?: unknown;
  response_document?: unknown;
}

interface CounterpartyKycOwnerPayload {
  birth_date?: unknown;
  document?: unknown;
  full_name?: unknown;
  relationship_level?: unknown;
  relationship_name?: unknown;
  relationship_type?: unknown;
}

interface WithdrawNetworkPayload {
  address_regex?: unknown;
  addressRegex?: unknown;
  network?: unknown;
  user_friendly_network_name?: unknown;
  userFriendlyNetworkName?: unknown;
  withdraw_desc?: unknown;
  withdrawDesc?: unknown;
  withdraw_fee?: unknown;
  withdrawFee?: unknown;
  withdraw_fee_brl_estimate?: unknown;
  withdrawFeeBrlEstimate?: unknown;
  withdraw_integer_multiple?: unknown;
  withdrawIntegerMultiple?: unknown;
  withdraw_max?: unknown;
  withdrawMax?: unknown;
  withdraw_min?: unknown;
  withdrawMin?: unknown;
  withdraw_tag?: unknown;
  withdrawTag?: unknown;
}

interface WalletRiskPayload {
  failure_reasons?: unknown;
  network?: unknown;
  risk_result?: unknown;
  wallet?: unknown;
}

interface PixKeyOwnerPayload {
  key_owner_result?: unknown;
  pix_owner_info?: unknown;
}

interface PreOrderPayload {
  coupon_is_valid?: unknown;
  fee_asset?: unknown;
  fee_fiat?: unknown;
  input_amount?: unknown;
  input_asset?: unknown;
  output_amount_gross?: unknown;
  output_amount_net?: unknown;
  output_asset?: unknown;
  price?: unknown;
  price_is_valid?: unknown;
}

interface CreateOrderPayload {
  success?: unknown;
  order_is_valid?: unknown;
  order_details?: {
    order_id?: unknown;
    payment_data?: unknown;
    status?: unknown;
  };
}

function buildOtcUrl(baseUrl: string, routeSuffix: string) {
  const path = resolveSameOriginOtcPath(`/otc/${routeSuffix}`);
  const normalized = baseUrl.replace(/\/+$/, "");
  if (!normalized) {
    return path;
  }
  return `${normalized}/otc/${routeSuffix}`;
}

async function postOtcJson<T>(config: PricingConfig, routeSuffix: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(buildOtcUrl(config.quoteBaseUrl, routeSuffix), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `${routeSuffix} failed with status ${response.status}`);
  }

  const payload = (await response.json()) as OtcEnvelope<T> & {
    order_is_valid?: unknown;
    order_details?: unknown;
  };
  // `create_order` returns the payload at the top level instead of nesting under `data`.
  if (routeSuffix === "create_order" && payload.success !== false && payload.data == null && payload.order_details != null) {
    return payload as unknown as T;
  }
  if (payload.success === false || payload.data == null) {
    const msg =
      typeof payload.error === "string" && payload.error.trim()
        ? payload.error
        : typeof payload.message === "string" && payload.message.trim()
          ? payload.message
          : "";
    throw new Error(msg || `${routeSuffix} returned an invalid payload.`);
  }
  return payload.data;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asRecordUnknown(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function serializeKycInfo(kyc: OtcKycInfoPayload) {
  return {
    name: kyc.name,
    document: kyc.document,
    kyc_result: kyc.kycResult
  };
}

function sellNetworkInfoForOtc(network: OtcWithdrawNetwork): string {
  return network.network.trim();
}

function serializePaymentInfoForOtc(
  input: PreOrderValidationInput | CreateOrderInput
): Record<string, unknown> {
  if (input.tradeType === "SELL") {
    const depositNetwork = sellNetworkInfoForOtc(input.networkInfo);
    return {
      pix_key: input.paymentInfo.pixKey,
      network: depositNetwork
    };
  }
  return {
    wallet: input.paymentInfo.wallet,
    network: input.paymentInfo.network
  };
}

function serializePreOrderV2(input: PreOrderValidationInput | CreateOrderInput, preOrder: OtcPreOrderValidation) {
  const base: Record<string, unknown> = {
    price_is_valid: preOrder.priceIsValid,
    coupon_is_valid: preOrder.couponIsValid,
    price: preOrder.price,
    input_asset: preOrder.inputAsset,
    input_amount: preOrder.inputAmount,
    output_asset: preOrder.outputAsset,
    output_amount_gross: preOrder.outputAmountGross,
    fee_asset: preOrder.feeAsset,
    fee_fiat: preOrder.feeFiat,
    output_amount_net: preOrder.outputAmountNet,
    payment_info: serializePaymentInfoForOtc(input)
  };
  if (input.tradeType === "SELL") {
    base.network_info = sellNetworkInfoForOtc(input.networkInfo);
  }
  return base;
}

function mapWithdrawNetworkPayload(item: WithdrawNetworkPayload): OtcWithdrawNetwork {
  return {
    addressRegex: asString(item.addressRegex ?? item.address_regex) || undefined,
    network: asString(item.network),
    userFriendlyNetworkName: asString(item.userFriendlyNetworkName ?? item.user_friendly_network_name, asString(item.network)),
    withdrawDesc: asString(item.withdrawDesc ?? item.withdraw_desc) || undefined,
    withdrawFee: asNumber(item.withdrawFee ?? item.withdraw_fee),
    withdrawFeeBrlEstimate: asNumber(item.withdrawFeeBrlEstimate ?? item.withdraw_fee_brl_estimate),
    withdrawIntegerMultiple: asString(item.withdrawIntegerMultiple ?? item.withdraw_integer_multiple) || undefined,
    withdrawMax: asString(item.withdrawMax ?? item.withdraw_max) || undefined,
    withdrawMin: asString(item.withdrawMin ?? item.withdraw_min) || undefined,
    withdrawTag: typeof (item.withdrawTag ?? item.withdraw_tag) === "boolean" ? Boolean(item.withdrawTag ?? item.withdraw_tag) : undefined
  };
}

function mapPreOrderPayload(data: PreOrderPayload, fallbackPrice: number): OtcPreOrderValidation {
  return {
    priceIsValid: asBoolean(data.price_is_valid),
    couponIsValid: asBoolean(data.coupon_is_valid),
    price: asNumber(data.price, fallbackPrice),
    inputAsset: asString(data.input_asset),
    inputAmount: asNumber(data.input_amount),
    outputAsset: asString(data.output_asset),
    outputAmountGross: asNumber(data.output_amount_gross),
    feeAsset: asNumber(data.fee_asset),
    feeFiat: asNumber(data.fee_fiat),
    outputAmountNet: asNumber(data.output_amount_net)
  };
}

/** OTC `create_order` expects `price` as a decimal string (e.g. `"4.938"`). */
function otcDecimalString(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  const s = amount.toFixed(10).replace(/\.?0+$/, "");
  if (s === "" || s === "-0") return "0";
  return s;
}

function normalizeApprovedKyc(result: string): "approved" | "rejected" {
  return result === "approve" || result === "approved" || result === "review"
    ? "approved"
    : "rejected";
}

function normalizeBirthDate(value: unknown): string | null {
  const raw = asString(value).trim();
  if (!raw) return null;
  const dateOnly = raw.includes("T") ? raw.slice(0, raw.indexOf("T")) : raw;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : null;
}

function normalizeCounterpartyKycOwners(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const owner = item as CounterpartyKycOwnerPayload;
    const document = asString(owner.document).trim();
    const fullName = asString(owner.full_name).trim();
    if (!document || !fullName) {
      return [];
    }
    return [
      {
        birthDate: normalizeBirthDate(owner.birth_date),
        document,
        fullName,
        relationshipLevel: asString(owner.relationship_level).trim(),
        relationshipName: asString(owner.relationship_name).trim(),
        relationshipType: asString(owner.relationship_type).trim()
      }
    ];
  });
}

export async function submitCounterpartyKycHttp(
  config: PricingConfig,
  payload: KycSubmitPayload
): Promise<KycSubmitResult> {
  const data = await postOtcJson<CounterpartyKycPayload>(config, "counterparty_kyc", {
    document: payload.documentNumber,
    document_type: payload.documentType,
    requester: "otc"
  });
  const rawResult = asString(data.kyc_result).trim().toLowerCase();
  const approvedKycResult = normalizeApprovedKyc(rawResult);
  return {
    approved: approvedKycResult === "approved",
    approvedKycResult,
    kycDate: Date.now(),
    personType: payload.documentType,
    kycName: asString(data.full_name || data.company_name).trim() || null,
    birthDate: normalizeBirthDate(data.birth_date),
    failureReasons: asStringArray(data.failure_reasons),
    companyName: asString(data.company_name).trim() || null,
    ownersInfo: normalizeCounterpartyKycOwners(data.owners_info),
    responseDocument: asString(data.response_document ?? data.document).trim() || null
  };
}

export async function getAvailableWithdrawNetworksHttp(
  config: PricingConfig,
  asset: string
): Promise<OtcWithdrawNetwork[]> {
  const data = await postOtcJson<WithdrawNetworkPayload[]>(config, "get_available_withdraw_networks", {
    asset
  });
  return data.map(mapWithdrawNetworkPayload);
}

export async function getAvailableDepositNetworksHttp(
  config: PricingConfig,
  asset: string
): Promise<OtcWithdrawNetwork[]> {
  const data = await postOtcJson<WithdrawNetworkPayload[]>(config, "get_available_deposit_networks", {
    asset
  });
  return data.map(mapWithdrawNetworkPayload);
}

export async function checkPixKeyOwnerHttp(
  config: PricingConfig,
  inputDocument: string,
  inputKey: string
): Promise<OtcPixKeyOwnerCheck> {
  const response = await fetch(buildOtcUrl(config.quoteBaseUrl, "check_pix_key_owner"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      input_document: inputDocument,
      input_key: inputKey
    })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `check_pix_key_owner failed with status ${response.status}`);
  }
  const payload = (await response.json()) as OtcEnvelope<PixKeyOwnerPayload> & PixKeyOwnerPayload;
  const data = (payload.data ?? payload) as PixKeyOwnerPayload;
  const keyOwnerResult = asBoolean(data.key_owner_result);
  return {
    approved: keyOwnerResult,
    keyOwnerResult,
    pixOwnerInfo: asRecordUnknown(data.pix_owner_info)
  };
}

export async function checkWalletRiskHttp(
  config: PricingConfig,
  walletAddress: string,
  network: string
): Promise<OtcWalletRiskCheck> {
  const data = await postOtcJson<WalletRiskPayload>(config, "check_wallet_risk", {
    wallet: walletAddress,
    network
  });
  const riskResult = asString(data.risk_result).trim().toLowerCase();
  return {
    approved: riskResult === "approved",
    riskResult,
    wallet: asString(data.wallet, walletAddress),
    network: asString(data.network, network),
    failureReasons: asRecordUnknown(data.failure_reasons)
  };
}

export async function preOrderValidationHttp(
  config: PricingConfig,
  input: PreOrderValidationInput
): Promise<OtcPreOrderValidation> {
  const body: Record<string, unknown> = {
    version: "v2",
    asset: input.asset,
    trade_type: input.tradeType,
    coupon: input.coupon?.trim() || undefined,
    payment_info: serializePaymentInfoForOtc(input),
    price: input.price,
    amount: input.amount,
    document: input.document,
    document_type: input.documentType,
    kyc_info: serializeKycInfo(input.kycInfo)
  };
  if (input.tradeType === "SELL") {
    body.network_info = sellNetworkInfoForOtc(input.networkInfo);
  }
  const data = await postOtcJson<PreOrderPayload>(config, "pre_order_validation", body);
  return mapPreOrderPayload(data, input.price);
}

export async function createOrderHttp(config: PricingConfig, input: CreateOrderInput): Promise<Order> {
  const emailNorm = input.email.trim().toLowerCase();
  const clientId = `${emailNorm}_webapp_${input.country.toLowerCase()}`;
  const body: Record<string, unknown> = {
    version: "v2",
    asset: input.asset,
    trade_type: input.tradeType,
    document: input.document,
    document_type: input.documentType,
    amount: input.amount,
    coupon: input.coupon?.trim() || undefined,
    kyc_info: serializeKycInfo(input.kycInfo),
    price: otcDecimalString(input.preOrder.price),
    client_id: clientId,
    payment_info: serializePaymentInfoForOtc(input),
    client_data: {
      id: emailNorm,
      email: emailNorm,
      document: input.document,
      person_type: input.documentType,
      kyc_name: input.kycInfo.name,
      approved_kyc_result: input.kycInfo.kycResult,
      kyc_date: input.kycTs,
      country: input.country,
      platform: "webapp"
    },
    pre_order: serializePreOrderV2(input, input.preOrder)
  };
  if (input.tradeType === "SELL") {
    body.network_info = sellNetworkInfoForOtc(input.networkInfo);
  }
  const data = await postOtcJson<CreateOrderPayload>(config, "create_order", body);

  const orderId = asString(data.order_details?.order_id);
  if (!orderId) {
    throw new Error("create_order returned an order without order_id.");
  }

  if (input.tradeType === "SELL") {
    const sellInput = input as SellCreateOrderInput;
    const order: Order = {
      id: orderId,
      email: input.email,
      tradeSide: "sell",
      asset: sellInput.asset,
      amount: input.preOrder.outputAmountNet,
      quoteTotal: input.preOrder.inputAmount,
      status: asString(data.order_details?.status, "waiting_for_payment"),
      createdAt: Date.now(),
      amountToPay: input.preOrder.inputAmount,
      orderIsValid: asBoolean(data.order_is_valid, true),
      inputAsset: input.preOrder.inputAsset || sellInput.asset,
      outputAsset: input.preOrder.outputAsset,
      paymentData: {
        ...(data.order_details?.payment_data && typeof data.order_details.payment_data === "object"
          ? (data.order_details.payment_data as Order["paymentData"])
          : {}),
        network: sellInput.networkInfo.network,
        pixKey: sellInput.paymentInfo.pixKey,
        payload:
          asString((data.order_details?.payment_data as Record<string, unknown> | undefined)?.payload) ||
          asString((data.order_details?.payment_data as Record<string, unknown> | undefined)?.qr_code) ||
          undefined,
        walletAddress:
          asString(
            (data.order_details?.payment_data as Record<string, unknown> | undefined)?.wallet_address
          ) ||
          asString((data.order_details?.payment_data as Record<string, unknown> | undefined)?.walletAddress) ||
          asString((data.order_details?.payment_data as Record<string, unknown> | undefined)?.payload) ||
          asString((data.order_details?.payment_data as Record<string, unknown> | undefined)?.qr_code) ||
          undefined
      },
      price: input.preOrder.price
    };
    cacheOrder(order, buildCreateOrderSummaryFromInput(input));
    return order;
  }

  const buyInput = input as BuyCreateOrderInput;
  const order: Order = {
    id: orderId,
    email: input.email,
    tradeSide: "buy",
    asset: buyInput.asset,
    amount: input.preOrder.outputAmountNet,
    quoteTotal: input.preOrder.inputAmount,
    status: asString(data.order_details?.status, "waiting_for_payment"),
    createdAt: Date.now(),
    amountToPay: input.preOrder.inputAmount,
    orderIsValid: asBoolean(data.order_is_valid, true),
    inputAsset: input.preOrder.inputAsset,
    outputAsset: input.preOrder.outputAsset || buyInput.asset,
    paymentData: {
      ...(data.order_details?.payment_data && typeof data.order_details.payment_data === "object"
        ? (data.order_details.payment_data as Order["paymentData"])
        : {}),
      network: buyInput.paymentInfo.network,
      walletAddress: buyInput.paymentInfo.wallet
    },
    price: input.preOrder.price
  };
  cacheOrder(order, buildCreateOrderSummaryFromInput(input));
  return order;
}

export async function getCachedOrderStatusHttp(id: string): Promise<Order | null> {
  return getCachedOrder(id);
}
