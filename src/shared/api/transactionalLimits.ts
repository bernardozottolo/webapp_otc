import type { OtcTransactionalAllowance } from "../types";
import type { PricingConfig } from "./pricing";
import { resolveSameOriginOtcPath } from "./otcUrls";

export interface CounterpartyTransactionalLimitBody {
  document: string;
  kyc_result: string;
}

export interface TransactionHistoryBody {
  fiat: string;
  first_name: string;
  document: string;
}

function buildOtcUrl(baseUrl: string, routeSuffix: string) {
  const path = resolveSameOriginOtcPath(`/otc/${routeSuffix}`);
  const normalized = baseUrl.replace(/\/+$/, "");
  if (!normalized) return path;
  return `${normalized}/otc/${routeSuffix}`;
}

async function postOtcJson<T>(baseUrl: string, routeSuffix: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(buildOtcUrl(baseUrl, routeSuffix), {
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

  return (await response.json()) as T;
}

interface TransactionHistoryEnvelope {
  success?: boolean;
  data?: {
    transacted_history_amount?: unknown;
    document?: unknown;
    fiat?: unknown;
  };
}

interface LimitEnvelope {
  success?: boolean;
  data?: {
    approved_kyc_limit?: unknown;
    document?: unknown;
    kyc_result?: unknown;
  };
}

export function remainderTransactionalFiat(maxApproved: number, transactedHistory: number): number {
  const r = maxApproved - transactedHistory;
  return Number.isFinite(r) ? Math.max(0, r) : 0;
}

export async function getTransactionalAllowanceHttp(
  config: PricingConfig,
  input: TransactionHistoryBody & Pick<CounterpartyTransactionalLimitBody, "kyc_result">
): Promise<OtcTransactionalAllowance> {
  const [historyPayload, limitPayload] = await Promise.all([
    postOtcJson<TransactionHistoryEnvelope>(config.quoteBaseUrl, "get_transaction_history", {
      fiat: input.fiat,
      first_name: input.first_name,
      document: input.document
    }),
    postOtcJson<LimitEnvelope>(config.quoteBaseUrl, "get_counterparty_transactional_limit", {
      document: input.document,
      kyc_result: input.kyc_result
    })
  ]);

  if (historyPayload.success === false || limitPayload.success === false) {
    throw new Error("Transactional limit API returned success: false.");
  }

  if (!historyPayload.data || !limitPayload.data) {
    throw new Error("Transactional limit API returned empty data.");
  }

  const transactedRaw = historyPayload.data.transacted_history_amount;
  const limitRaw = limitPayload.data.approved_kyc_limit;

  const transactedHistoryAmount = typeof transactedRaw === "number" ? transactedRaw : Number(transactedRaw);
  const approvedKycLimit = typeof limitRaw === "number" ? limitRaw : Number(limitRaw);

  if (!Number.isFinite(transactedHistoryAmount) || transactedHistoryAmount < 0) {
    throw new Error("Transactional history amount is invalid.");
  }
  if (!Number.isFinite(approvedKycLimit) || approvedKycLimit < 0) {
    throw new Error("Transactional approved limit is invalid.");
  }

  const remainingFiat = remainderTransactionalFiat(approvedKycLimit, transactedHistoryAmount);

  return {
    approvedKycLimit,
    transactedHistoryAmount,
    remainingFiat
  };
}
