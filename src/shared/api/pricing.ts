import type { Country, Customer, NegotiationAssetInfo, QuoteRequest, QuoteResponse, TradeSide } from "../types";
import { resolveSameOriginOtcPath } from "./otcUrls";

export interface PricingConfig {
  quoteBaseUrl: string;
  updateWebhookBaseUrl: string;
}

interface PricingSides {
  BUY?: unknown;
  SELL?: unknown;
  BUY_FINAL?: unknown;
  BUY_STANDARD?: unknown;
  SELL_FINAL?: unknown;
  SELL_STANDARD?: unknown;
}

interface GetPricingPayload {
  data?: Record<string, PricingSides>;
  coupon_is_valid?: unknown;
  success?: boolean;
}

interface NegotiationAssetInfoPayload {
  asset?: unknown;
  trade_types?: unknown;
  tradeTypes?: unknown;
  decimal_precision?: unknown;
  decimalPrecision?: unknown;
  decimal_precision_asset?: unknown;
  decimalPrecisionAsset?: unknown;
  decimal_precision_fiat?: unknown;
  decimalPrecisionFiat?: unknown;
  min_negotiation_value_fiat?: unknown;
  minNegotiationValueFiat?: unknown;
}

interface GetNegotiationAssetsPayload {
  data?: NegotiationAssetInfoPayload[];
  success?: boolean;
}

function buildPricingUrl(baseUrl: string, route = "get_pricing") {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (!normalized) {
    return resolveSameOriginOtcPath(`/otc/${route}`);
  }
  return `${normalized}/otc/${route}`;
}
/** Shape expected by `/otc/get_pricing` (snake_case), aligned with clients_db row + UI country. */
export function customerToPricingClientData(customer: Customer, jurisdictionCountry: Country): Record<string, unknown> {
  return {
    id: customer.id ?? customer.email,
    email: customer.email,
    approved_kyc_result: customer.approvedKycResult ?? null,
    country: jurisdictionCountry,
    created_at: customer.createdAt ?? null,
    document: customer.documentNumber ?? null,
    email_pending_verification: customer.emailPendingVerification ?? null,
    email_verified: customer.emailVerified ?? false,
    kyc_date: customer.kycDate ?? null,
    kyc_name: customer.kycName ?? null,
    last_successful_biometric: customer.lastSuccessfulBiometric ?? null,
    last_updated_at: customer.lastUpdatedAt ?? null,
    person_type: customer.personType ?? customer.documentType ?? null,
    platform: customer.platform ?? "webapp",
    transactional_limit: customer.transactionalLimit ?? null,
    waiting_response: customer.waitingResponse ?? null,
    waiting_url: customer.waitingUrl ?? null
  };
}

function buildPricingRequestBody(input: { country: Country; customer?: Customer | null; coupon?: string }) {
  const hasCustomer = Boolean(input.customer);
  const document = hasCustomer ? (input.customer?.documentNumber?.trim() || null) : null;
  const clientData = hasCustomer && input.customer ? customerToPricingClientData(input.customer, input.country) : null;
  const coupon = typeof input.coupon === "string" && input.coupon.trim() ? input.coupon.trim() : undefined;
  return {
    document,
    client_data: clientData,
    coupon
  };
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asTradeTypes(value: unknown): Array<"BUY" | "SELL"> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const normalized = typeof item === "string" ? item.trim().toUpperCase() : "";
    return normalized === "BUY" || normalized === "SELL" ? [normalized] : [];
  });
}

function pickPriceForTradeSide(
  sides: PricingSides | undefined,
  tradeSide: TradeSide
): { finalUnitPrice: number; standardUnitPrice: number } | null {
  if (!sides) return null;
  const rawFinal =
    tradeSide === "buy" ? (sides.BUY_FINAL ?? sides.BUY_STANDARD ?? sides.BUY) : (sides.SELL_FINAL ?? sides.SELL_STANDARD ?? sides.SELL);
  const rawStandard =
    tradeSide === "buy" ? (sides.BUY_STANDARD ?? sides.BUY_FINAL ?? sides.BUY) : (sides.SELL_STANDARD ?? sides.SELL_FINAL ?? sides.SELL);
  const finalUnitPrice = asNumber(rawFinal, Number.NaN);
  const standardUnitPrice = asNumber(rawStandard, finalUnitPrice);
  if (!(finalUnitPrice > 0) || !(standardUnitPrice > 0)) {
    return null;
  }
  return { finalUnitPrice, standardUnitPrice };
}

function findAssetPricing(data: Record<string, PricingSides>, asset: string): PricingSides | undefined {
  const upper = asset.toUpperCase();
  if (data[upper]) return data[upper];
  const found = Object.keys(data).find((k) => k.toUpperCase() === upper);
  return found ? data[found] : undefined;
}

interface DerivedQuotePricing {
  finalUnitPrice: number;
  standardUnitPrice: number;
  couponIsValid: boolean;
}

/** Recomputes totals from a cached pricing snapshot when only the amount changes locally. */
export function deriveQuoteResponseFromUnitPrice(req: QuoteRequest, pricing: number | DerivedQuotePricing): QuoteResponse {
  if (typeof pricing === "number") {
    return mapPricingToQuoteResponse(req, {
      finalUnitPrice: pricing,
      standardUnitPrice: pricing,
      couponIsValid: false
    });
  }
  return mapPricingToQuoteResponse(req, pricing);
}

function mapPricingToQuoteResponse(req: QuoteRequest, pricing: DerivedQuotePricing): QuoteResponse {
  // UI quote must reflect the raw OTC pricing snapshot. Network fee is applied separately
  // once the user selects a destination wallet/network.
  const feePercent = 0;
  const feeAmount = 0;
  const unitPrice = pricing.finalUnitPrice;
  const outputAmount =
    req.tradeSide === "buy" ? Math.max(req.amount / unitPrice, 0) : Math.max(req.amount * unitPrice, 0);
  const totalFiat = req.tradeSide === "buy" ? req.amount : outputAmount;

  return {
    tradeSide: req.tradeSide,
    unitPrice,
    standardUnitPrice: pricing.standardUnitPrice,
    finalUnitPrice: pricing.finalUnitPrice,
    couponIsValid: pricing.couponIsValid,
    feePercent,
    feeAmount,
    inputAmount: req.amount,
    outputAmount,
    totalFiat,
    updatedAt: new Date().toISOString()
  };
}

export async function getQuoteHttp(config: PricingConfig, req: QuoteRequest): Promise<QuoteResponse> {
  const response = await fetch(buildPricingUrl(config.quoteBaseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(buildPricingRequestBody(req))
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `get_pricing failed with status ${response.status}`);
  }

  const payload = (await response.json()) as GetPricingPayload;

  if (payload.success === false || !payload.data || typeof payload.data !== "object") {
    throw new Error("get_pricing returned invalid payload.");
  }

  const assetRow = findAssetPricing(payload.data, req.asset);
  const pricing = pickPriceForTradeSide(assetRow, req.tradeSide);

  if (pricing == null) {
    throw new Error(`No ${req.tradeSide.toUpperCase()} price for asset ${req.asset}.`);
  }

  return deriveQuoteResponseFromUnitPrice(req, {
    ...pricing,
    couponIsValid: Boolean(payload.coupon_is_valid)
  });
}

export async function getNegotiationAssetsHttp(
  config: PricingConfig,
  input: {
    country: Country;
    customer?: Customer | null;
    coupon?: string;
  }
): Promise<NegotiationAssetInfo[]> {
  const response = await fetch(buildPricingUrl(config.quoteBaseUrl, "negotiation_assets_info"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(buildPricingRequestBody(input))
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `negotiation_assets_info failed with status ${response.status}`);
  }

  const payload = (await response.json()) as GetNegotiationAssetsPayload;

  if (payload.success === false || !Array.isArray(payload.data)) {
    throw new Error("negotiation_assets_info returned invalid payload.");
  }

  return payload.data
    .map((item) => ({
      asset: asString(item.asset).trim().toUpperCase(),
      tradeTypes: asTradeTypes(item.tradeTypes ?? item.trade_types),
      decimalPrecisionAsset: Math.max(
        0,
        Math.trunc(asNumber(item.decimalPrecisionAsset ?? item.decimal_precision_asset ?? item.decimalPrecision ?? item.decimal_precision, 6))
      ),
      decimalPrecisionFiat: Math.max(
        0,
        Math.trunc(asNumber(item.decimalPrecisionFiat ?? item.decimal_precision_fiat, 2))
      ),
      minNegotiationValueFiat: Math.max(0, asNumber(item.minNegotiationValueFiat ?? item.min_negotiation_value_fiat, 0))
    }))
    .filter((item) => item.asset && item.tradeTypes.length > 0);
}
