import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { otcApiClient } from "../../shared/api/client";
import { setWindowOrderPayload } from "../../shared/api/orderCache";
import type { CompanyKycOwnerInfo, KycSubmitResult } from "../../shared/api/contracts";
import { useI18n } from "../../shared/i18n";
import { deriveQuoteResponseFromUnitPrice } from "../../shared/api/pricing";
import { sendFrontendTelemetryEvent } from "../../shared/api/telemetry";
import type {
  Country,
  Customer,
  Limits,
  Locale,
  NegotiationAssetInfo,
  OtcWithdrawNetwork,
  OtcTransactionalAllowance,
  PaymentData,
  QuoteRequest,
  QuoteResponse,
  TradeSide
} from "../../shared/types";
import { Modal } from "../../shared/ui/Modal";
import type { BrandConfig } from "../../whitelabel/config";
import { createOrderLoadingDocument, createOrderStatusMessageDocument } from "../../whitelabel/orderLoadingDocument";
import { startBiometricSession } from "../customer/diditAdapter";

type Step = "none" | "email" | "otp" | "kyc" | "bio" | "payment";
type BiometryReason = "onboarding" | "payment";
type CounterpartyKycMode = "onboarding" | "refresh";
type PendingKycApproval = Pick<KycSubmitResult, "approvedKycResult" | "kycDate" | "personType" | "kycName" | "birthDate"> & {
  documentNumber: string;
};
type CompanyRepresentativeContext = {
  companyName: string | null;
  companyDocumentNumber: string;
  companyDocumentType: string;
  ownersInfo: CompanyKycOwnerInfo[];
};
type BiometricIdentityOverride = {
  documentNumber: string;
  kycName: string | null;
  birthDate: string | null;
  companyDocumentNumber?: string | null;
};
type BlockingUiState = {
  title: string;
  description?: string;
};

const INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_ASSET_DECIMAL_PRECISION = 6;
const QUOTE_MAX_AGE_MS = 60 * 1000;

interface FlowPageProps {
  brand: BrandConfig;
  country: Country;
  locale: Locale;
}

type FooterContactKind = keyof BrandConfig["footer"]["contacts"];

const FOOTER_CONTACT_ORDER: FooterContactKind[] = ["phone", "whatsapp", "email", "linkedin", "facebook", "instagram"];

const FOOTER_CONTACT_LABELS: Record<FooterContactKind, string> = {
  phone: "Telefone",
  whatsapp: "WhatsApp",
  email: "E-mail",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram"
};

function buildFooterContactHref(kind: FooterContactKind, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(tel:|mailto:|https?:\/\/)/i.test(trimmed)) {
    return trimmed;
  }
  if (kind === "phone") {
    const normalized = trimmed.replace(/[^\d+]/g, "");
    return normalized ? `tel:${normalized}` : trimmed;
  }
  if (kind === "whatsapp") {
    const normalized = trimmed.replace(/\D/g, "");
    return normalized ? `https://wa.me/${normalized}` : trimmed;
  }
  if (kind === "email") {
    return `mailto:${trimmed}`;
  }
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

function footerContactOpensInNewTab(kind: FooterContactKind, href: string) {
  if (kind === "phone" || kind === "email") {
    return false;
  }
  return /^https?:\/\//i.test(href);
}

function hasQuoteExpired(updatedAt: string | null | undefined, nowMs: number) {
  if (!updatedAt) return true;
  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) return true;
  return nowMs - updatedAtMs > QUOTE_MAX_AGE_MS;
}

function renderFooterContactIcon(kind: FooterContactKind) {
  switch (kind) {
    case "phone":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24c1.08.36 2.24.54 3.4.54a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C11.72 21 3 12.28 3 1.2a1 1 0 0 1 1-1H7.5a1 1 0 0 1 1 1c0 1.16.18 2.32.54 3.4a1 1 0 0 1-.24 1l-2.2 2.2Z" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.2a9.8 9.8 0 0 0-8.47 14.72L2 22l5.24-1.5A9.8 9.8 0 1 0 12 2.2Zm0 17.8a7.9 7.9 0 0 1-4.03-1.1l-.29-.17-3.12.89.9-3.04-.19-.31A7.9 7.9 0 1 1 12 20Zm4.33-5.93c-.24-.12-1.43-.7-1.65-.77-.22-.08-.38-.12-.54.12-.16.24-.62.77-.77.92-.14.16-.28.18-.52.06-.24-.12-1-.37-1.9-1.19-.7-.62-1.17-1.38-1.31-1.61-.14-.24-.02-.36.1-.48.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.29-.74-1.77-.2-.47-.4-.4-.54-.4h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 1.99s.86 2.3.98 2.46c.12.16 1.69 2.58 4.1 3.62.57.25 1.02.4 1.36.5.57.18 1.08.16 1.49.1.46-.07 1.43-.58 1.63-1.14.2-.55.2-1.02.14-1.12-.06-.1-.22-.16-.46-.28Z" />
        </svg>
      );
    case "email":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-13Zm2 0v.36l7 5.24 7-5.24V5.5a.5.5 0 0 0-.5-.5h-13a.5.5 0 0 0-.5.5Zm14 2.86-6.4 4.8a1 1 0 0 1-1.2 0L5 8.36V18.5c0 .28.22.5.5.5h13a.5.5 0 0 0 .5-.5V8.36Z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6.94 8.5H3.56V20H6.94V8.5ZM5.25 3A1.97 1.97 0 1 0 5.3 6.94 1.97 1.97 0 0 0 5.25 3ZM20 12.72c0-3.46-1.85-5.07-4.32-5.07-1.99 0-2.88 1.09-3.38 1.86V8.5H8.94c.04.67 0 11.5 0 11.5h3.37v-6.42c0-.34.02-.68.13-.92.27-.68.9-1.38 1.96-1.38 1.38 0 1.93 1.04 1.93 2.57V20H20v-7.28Z" />
        </svg>
      );
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M13.5 21v-7.3H16l.38-3H13.5V8.8c0-.87.24-1.46 1.49-1.46h1.59V4.66c-.28-.04-1.2-.12-2.28-.12-2.26 0-3.8 1.37-3.8 3.9v2.26H8v3h2.49V21h3.01Z" />
        </svg>
      );
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2A3 3 0 0 0 4 7v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm11.5 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
        </svg>
      );
  }
}

function maskWallet(value?: string) {
  if (!value) return "";
  if (value.length <= 15) return value;
  return `${value.slice(0, 6)}***${value.slice(-6)}`;
}

function maskBankKey(value?: string) {
  if (!value) return "";
  if (value.length <= 8) return value;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function deriveFirstNameForOtc(customer: Customer) {
  const raw = (customer.kycName || customer.fullName || "").trim();
  const firstFromName = raw ? raw.split(/\s+/)[0] : "";
  if (firstFromName) return firstFromName;
  const fromEmail = customer.email.split("@")[0]?.split(/[._-]/)[0]?.trim();
  if (fromEmail) return fromEmail.charAt(0).toUpperCase() + fromEmail.slice(1);
  return "";
}

/** Maps internal `approved` / `rejected` API values → counterparty OTC `kyc_result` (`approve`, etc.). */
function mapApprovedKycToCounterpartyPayload(approvedKycResult?: string | null) {
  const v = (approvedKycResult || "").toLowerCase();
  if (v === "approved") return "approve";
  if (v === "rejected") return "rejected";
  return "approve";
}

function hasApprovedCounterpartyKyc(approvedKycResult?: string | null) {
  const normalized = (approvedKycResult || "").trim().toLowerCase();
  return normalized === "approved" || normalized === "approve";
}

function hasExpiredCounterpartyKyc(customer: Customer | null, otcKycValidityDays: number) {
  if (!customer || otcKycValidityDays <= 0) {
    return false;
  }
  if (!customer.kycDate || !Number.isFinite(customer.kycDate)) {
    return true;
  }
  return Date.now() - customer.kycDate > otcKycValidityDays * 24 * 60 * 60 * 1000;
}

function formatFiatAmount(locale: Locale, currencyCode: string, amount: number) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

function formatFiatAmountWithPrecision(locale: Locale, currencyCode: string, amount: number, fractionDigits: number) {
  const safeFractionDigits = Math.max(0, fractionDigits);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: safeFractionDigits,
      maximumFractionDigits: safeFractionDigits
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(safeFractionDigits)}`;
  }
}

const FIAT_OVER_EPS = 1e-9;

function formatFiatInputMax(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const rounded = Math.round(Math.min(n, Number.MAX_SAFE_INTEGER) * 100) / 100;
  if (Number.isInteger(rounded)) return String(Math.round(rounded));
  return String(rounded);
}

/** Match saved payment network against `get_available_withdraw_networks` list (case / whitespace tolerant). */
function findWithdrawNetworkByCode(networks: OtcWithdrawNetwork[], savedNetwork?: string | null): OtcWithdrawNetwork | undefined {
  const key = (savedNetwork ?? "").trim().toUpperCase();
  if (!key) return undefined;
  return networks.find((item) => (item.network ?? "").trim().toUpperCase() === key);
}

function formatSellCryptoClamp(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const clipped = Math.round(n * 100) / 100;
  return formatFiatInputMax(clipped);
}

function normalizeDecimalInput(raw: string, maxFractionDigits: number) {
  const normalized = raw.replace(",", ".");
  if (normalized === "" || normalized === ".") {
    return normalized;
  }
  if (!/^\d*\.?\d*$/.test(normalized)) {
    return null;
  }
  const [integerPart, fractionPart = ""] = normalized.split(".");
  if (fractionPart.length <= maxFractionDigits) {
    return normalized;
  }
  return `${integerPart}.${fractionPart.slice(0, maxFractionDigits)}`;
}

function formatAssetQuoteAmount(amount: number, decimalPrecision: number) {
  if (!Number.isFinite(amount)) return "0";
  return amount.toFixed(Math.max(0, decimalPrecision));
}

function formatNetworkFeeAmount(amount: number) {
  if (!Number.isFinite(amount)) return "0";
  return amount.toLocaleString("en-US", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: 20
  });
}

function normalizeDocumentValue(value: string) {
  return value.replace(/\D/g, "") || value.trim();
}

function sameDocumentValue(left?: string | null, right?: string | null) {
  return normalizeDocumentValue(left ?? "") === normalizeDocumentValue(right ?? "");
}

export function FlowPage({ brand, country, locale }: FlowPageProps) {
  const { t } = useI18n();
  const inactivityTimerRef = useRef<number | null>(null);

  const [tradeSide, setTradeSide] = useState<TradeSide>("buy");
  const [asset, setAsset] = useState("USDT");
  const [inputAmount, setInputAmount] = useState("100");
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [couponFeedback, setCouponFeedback] = useState<"idle" | "valid" | "invalid">("idle");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteFreshnessTick, setQuoteFreshnessTick] = useState(0);
  const [negotiationAssets, setNegotiationAssets] = useState<NegotiationAssetInfo[]>([]);
  const [negotiationAssetsLoading, setNegotiationAssetsLoading] = useState(false);

  const [step, setStep] = useState<Step>("none");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpPreview, setOtpPreview] = useState("");
  const [biometryReason, setBiometryReason] = useState<BiometryReason>("onboarding");
  const [counterpartyKycMode, setCounterpartyKycMode] = useState<CounterpartyKycMode>("onboarding");
  const [sessionBiometryDone, setSessionBiometryDone] = useState(false);

  const [identified, setIdentified] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [transactionalAllowance, setTransactionalAllowance] = useState<OtcTransactionalAllowance | null>(null);
  const [transactionalLoading, setTransactionalLoading] = useState(false);
  const [transactionalFetchError, setTransactionalFetchError] = useState(false);
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const [paymentSlotError, setPaymentSlotError] = useState<string | null>(null);
  const [pendingKyc, setPendingKyc] = useState<PendingKycApproval | null>(null);

  /** One silent re-run for payment biometry when doc verification/portrait path needs to start without alerting. */
  const paymentBiometryDocRetryConsumedRef = useRef(false);
  const lastCouponTelemetryKeyRef = useRef("");

  const [documentType, setDocumentType] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [documentTypes, setDocumentTypes] = useState<string[]>([]);
  const [companyRepresentativeContext, setCompanyRepresentativeContext] = useState<CompanyRepresentativeContext | null>(null);
  const [selectedOccupation, setSelectedOccupation] = useState("");
  const [selectedRepresentativeDocumentType, setSelectedRepresentativeDocumentType] = useState("");
  const [selectedRepresentativeDocumentNumber, setSelectedRepresentativeDocumentNumber] = useState("");
  const [occupationValidationMessage, setOccupationValidationMessage] = useState<string | null>(null);
  const [representativeValidationMessage, setRepresentativeValidationMessage] = useState<string | null>(null);
  const [biometricIdentityOverride, setBiometricIdentityOverride] = useState<BiometricIdentityOverride | null>(null);
  const [kycRejectedModalOpen, setKycRejectedModalOpen] = useState(false);

  const [network, setNetwork] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [bankKeyType, setBankKeyType] = useState("Telefone");
  const [bankKeyValue, setBankKeyValue] = useState("");
  const [networksAndFees, setNetworksAndFees] = useState<OtcWithdrawNetwork[]>([]);
  const [networksAndFeesLoading, setNetworksAndFeesLoading] = useState(false);
  const [blockingUi, setBlockingUi] = useState<BlockingUiState | null>(null);
  const bioAutostartedRef = useRef(false);

  const bankLabel = useMemo(() => brand.bankLabelByCountry[country] ?? brand.bankLabelByCountry[brand.defaultCountry], [brand, country]);
  const companyDocumentTypes = useMemo(
    () => brand.companyDocumentTypes[country] ?? brand.companyDocumentTypes[brand.defaultCountry] ?? [],
    [brand, country]
  );
  const occupations = useMemo(() => brand.occupations, [brand]);
  const occupationsAvailable = useMemo(() => brand.occupationsAvailable, [brand]);
  const personalDocumentTypes = useMemo(
    () => documentTypes.filter((doc) => !companyDocumentTypes.includes(doc.trim())),
    [documentTypes, companyDocumentTypes]
  );
  const isCompanyRepresentativeStep = Boolean(companyRepresentativeContext);
  const parsedAmount = useMemo(() => {
    const n = Number(inputAmount.trim().replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }, [inputAmount]);
  const tradeTypeFilter = tradeSide === "buy" ? "BUY" : "SELL";
  const assetOptions = useMemo(
    () => negotiationAssets.filter((item) => item.tradeTypes.includes(tradeTypeFilter)),
    [negotiationAssets, tradeTypeFilter]
  );
  const tradeTypeUnavailable = !negotiationAssetsLoading && assetOptions.length === 0;
  const tradeUnavailableMessage =
    tradeSide === "buy" ? brand.tradeAvailabilityTexts.buyUnavailable : brand.tradeAvailabilityTexts.sellUnavailable;
  const selectedAssetInfo = useMemo(
    () => assetOptions.find((item) => item.asset === asset) ?? null,
    [assetOptions, asset]
  );
  const assetDecimalPrecision = selectedAssetInfo?.decimalPrecisionAsset ?? DEFAULT_ASSET_DECIMAL_PRECISION;
  const fiatDecimalPrecision = selectedAssetInfo?.decimalPrecisionFiat ?? 2;
  const minNegotiationValueFiat = selectedAssetInfo?.minNegotiationValueFiat ?? 0;
  const hasFooterContent = useMemo(
    () =>
      Boolean(
        brand.footer.title.trim() ||
          brand.footer.description.trim() ||
          FOOTER_CONTACT_ORDER.some((kind) => brand.footer.contacts[kind].trim())
      ),
    [brand.footer]
  );
  const footerContacts = useMemo(
    () =>
      FOOTER_CONTACT_ORDER.flatMap((kind) => {
        const value = brand.footer.contacts[kind].trim();
        if (!value) {
          return [];
        }
        const href = buildFooterContactHref(kind, value);
        if (!href) {
          return [];
        }
        return [
          {
            kind,
            label: FOOTER_CONTACT_LABELS[kind],
            value,
            href,
            openInNewTab: footerContactOpensInNewTab(kind, href)
          }
        ];
      }),
    [brand.footer.contacts]
  );
  const footerWrapperStyle = useMemo(
    () => ({
      backgroundColor: brand.footer.colors.backgroundColor,
      borderColor: brand.footer.colors.borderColor
    }),
    [brand.footer.colors.backgroundColor, brand.footer.colors.borderColor]
  );
  const footerTitleStyle = useMemo(() => ({ color: brand.footer.colors.titleColor }), [brand.footer.colors.titleColor]);
  const footerDescriptionStyle = useMemo(
    () => ({ color: brand.footer.colors.descriptionColor }),
    [brand.footer.colors.descriptionColor]
  );
  const footerContactStyle = useMemo(() => ({ color: brand.footer.colors.contactColor }), [brand.footer.colors.contactColor]);
  const footerIconStyle = useMemo(
    () => ({ backgroundColor: brand.footer.colors.iconBackgroundColor }),
    [brand.footer.colors.iconBackgroundColor]
  );
  const kycRejectedMessage = useMemo(
    () =>
      [
        "Poxa! Após analisarmos sua solicitação identificamos que não será possível dar continuidade ao processo de abertura de conta. Por motivos de segurança e confidencialidade, não podemos fornecer maiores detalhes sobre esta decisão.",
        "",
        `Caso deseje mais informações ou ainda tenha dúvidas, pedimos que entre em contato pelo e-mail ${brand.supportEmail}.`,
        "",
        "Agradecemos pela compreensão.",
        "",
        "Atenciosamente,",
        `Equipe ${brand.companyName}`
      ].join("\n"),
    [brand.companyName, brand.supportEmail]
  );
  const openKycRejectedModal = useCallback(() => {
    setStep("none");
    setKycRejectedModalOpen(true);
  }, []);
  const pricingIdentityKey = useMemo(
    () => `${country}\u0001${locale}\u0001${customer?.email ?? ""}\u0001${customer?.documentNumber ?? ""}`,
    [country, locale, customer?.email, customer?.documentNumber]
  );
  /** When this changes we refetch OTC rates once and restart the 20s poll timer. Amount is excluded, coupon is not. */
  const quoteStructuralKey = useMemo(
    () => `${tradeSide}\u0001${asset}\u0001${country}\u0001${locale}\u0001${pricingIdentityKey}\u0001${appliedCoupon.trim()}`,
    [tradeSide, asset, country, locale, pricingIdentityKey, appliedCoupon]
  );

  const paymentContext = customer
    ? {
        email: customer.email,
        tradeSide,
        asset,
        country
      }
    : null;

  const lastPricingSuccessKeyRef = useRef("");
  const pricingSnapRef = useRef<{
    standardUnitPrice: number;
    finalUnitPrice: number;
    couponIsValid: boolean;
    fetchedAtIso: string;
    tradeSide: TradeSide;
    asset: string;
    locale: Locale;
    country: Country;
    pricingIdentityKey: string;
  } | null>(null);
  const latestQuoteInputsRef = useRef({
    tradeSide,
    asset,
    coupon: "",
    parsedAmount: 0,
    country,
    locale,
    customer: null as Customer | null
  });
  latestQuoteInputsRef.current = {
    tradeSide,
    asset,
    coupon: appliedCoupon.trim(),
    parsedAmount,
    country,
    locale,
    customer
  };

  const buildTelemetryUserContext = () => ({
    email: customer?.email ?? email,
    document: customer?.documentNumber ?? pendingKyc?.documentNumber ?? documentNumber,
    document_type: customer?.personType ?? customer?.documentType ?? documentType,
    identified,
    company_key: brand.backend.companyKey,
    platform: brand.backend.platform,
    country,
    locale
  });

  const buildTelemetryFlowState = () => ({
    step,
    trade_side: tradeSide,
    asset,
    input_amount: inputAmount,
    parsed_amount: parsedAmount,
    coupon_input: couponInput,
    applied_coupon: appliedCoupon,
    coupon_feedback: couponFeedback,
    quote,
    customer,
    limits,
    transactional_allowance: transactionalAllowance,
    transactional_loading: transactionalLoading,
    transactional_fetch_error: transactionalFetchError,
    payment_data: paymentData,
    payment_slot_error: paymentSlotError,
    pending_kyc: pendingKyc,
    document_type: documentType,
    document_number: documentNumber,
    company_representative_context: companyRepresentativeContext,
    selected_occupation: selectedOccupation,
    selected_representative_document_type: selectedRepresentativeDocumentType,
    selected_representative_document_number: selectedRepresentativeDocumentNumber,
    biometric_identity_override: biometricIdentityOverride,
    biometry_reason: biometryReason,
    counterparty_kyc_mode: counterpartyKycMode,
    session_biometry_done: sessionBiometryDone,
    network,
    wallet_address: walletAddress,
    bank_key_type: bankKeyType,
    bank_key_value: bankKeyValue,
    payment_context: paymentContext
  });

  const emitFrontendTelemetry = (
    event: string,
    payload: Record<string, unknown>,
    overrides?: {
      step?: string;
      userContext?: Record<string, unknown>;
    }
  ) => {
    void sendFrontendTelemetryEvent({
      event,
      step: overrides?.step ?? step,
      user_context: {
        ...buildTelemetryUserContext(),
        ...(overrides?.userContext ?? {})
      },
      payload: {
        flow_state: buildTelemetryFlowState(),
        ...payload
      }
    });
  };

  const refreshQuote = useCallback(async () => {
    const { tradeSide: side, asset: a, coupon: coup, parsedAmount: amt, country: ctry, locale: loc, customer: cust } =
      latestQuoteInputsRef.current;
    const idKey = `${ctry}\u0001${loc}\u0001${cust?.email ?? ""}\u0001${cust?.documentNumber ?? ""}`;
    const successKey = `${side}\u0001${a}\u0001${idKey}\u0001${coup}`;
    const availableAssets =
      side === "buy"
        ? negotiationAssets.filter((item) => item.tradeTypes.includes("BUY"))
        : negotiationAssets.filter((item) => item.tradeTypes.includes("SELL"));

    if (availableAssets.length === 0) {
      pricingSnapRef.current = null;
      lastPricingSuccessKeyRef.current = "";
      setQuote(null);
      setQuoteLoading(false);
      return;
    }

    if (!amt || !Number.isFinite(amt)) {
      pricingSnapRef.current = null;
      lastPricingSuccessKeyRef.current = "";
      setQuote(null);
      return;
    }

    setQuoteLoading(true);
    try {
      const response = await otcApiClient.getQuote({
        tradeSide: side,
        asset: a,
        amount: amt,
        coupon: coup || undefined,
        country: ctry,
        locale: loc,
        customer: cust ?? null
      });
      pricingSnapRef.current = {
        standardUnitPrice: response.standardUnitPrice,
        finalUnitPrice: response.finalUnitPrice,
        couponIsValid: response.couponIsValid,
        fetchedAtIso: response.updatedAt,
        tradeSide: side,
        asset: a,
        locale: loc,
        country: ctry,
        pricingIdentityKey: idKey
      };
      setQuote(response);
      setCouponFeedback(coup ? (response.couponIsValid ? "valid" : "invalid") : "idle");
      lastPricingSuccessKeyRef.current = successKey;
      if (coup) {
        const couponTelemetryKey = `${successKey}\u0001${response.couponIsValid}\u0001${response.updatedAt}`;
        if (lastCouponTelemetryKeyRef.current !== couponTelemetryKey) {
          lastCouponTelemetryKeyRef.current = couponTelemetryKey;
          void sendFrontendTelemetryEvent({
            event: "frontend_coupon_applied",
            step,
            user_context: {
              ...buildTelemetryUserContext()
            },
            payload: {
              flow_state: buildTelemetryFlowState(),
              pricing_request: {
                trade_side: side,
                asset: a,
                amount: amt,
                coupon: coup,
                country: ctry,
                locale: loc,
                customer: cust
              },
              pricing_response: response
            }
          });
        }
      }
    } catch {
      setQuote((prev: QuoteResponse | null) => {
        if (!prev) return null;
        return lastPricingSuccessKeyRef.current === successKey ? prev : null;
      });
      if (coup) {
        setCouponFeedback("idle");
      }
    } finally {
      setQuoteLoading(false);
    }
  }, [negotiationAssets]);

  const displayQuote = useMemo((): QuoteResponse | null => {
    const snap = pricingSnapRef.current;
    if (!(parsedAmount > 0) || !Number.isFinite(parsedAmount)) return null;

    const req: QuoteRequest = {
      tradeSide,
      asset,
      amount: parsedAmount,
      coupon: appliedCoupon.trim() || undefined,
      country,
      locale,
      customer: customer ?? null
    };

    if (!snap) return quote;
    if (
      snap.tradeSide !== tradeSide ||
      snap.asset !== asset ||
      snap.country !== country ||
      snap.locale !== locale ||
      snap.pricingIdentityKey !== pricingIdentityKey
    ) {
      return quote;
    }
    return {
      ...deriveQuoteResponseFromUnitPrice(req, {
        standardUnitPrice: snap.standardUnitPrice,
        finalUnitPrice: snap.finalUnitPrice,
        couponIsValid: snap.couponIsValid
      }),
      updatedAt: snap.fetchedAtIso
    };
  }, [parsedAmount, appliedCoupon, tradeSide, asset, country, locale, pricingIdentityKey, quote]);

  const quoteIsExpired = useMemo(
    () => hasQuoteExpired(displayQuote?.updatedAt, Date.now()),
    [displayQuote?.updatedAt, quoteFreshnessTick]
  );
  const actionableQuote = quoteIsExpired ? null : displayQuote;

  useEffect(() => {
    if (!displayQuote?.updatedAt) {
      return;
    }

    const updatedAtMs = Date.parse(displayQuote.updatedAt);
    if (!Number.isFinite(updatedAtMs)) {
      return;
    }

    const delayMs = Math.max(updatedAtMs + QUOTE_MAX_AGE_MS - Date.now(), 0) + 25;
    const timerId = window.setTimeout(() => {
      setQuoteFreshnessTick((current) => current + 1);
    }, delayMs);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [displayQuote?.updatedAt]);

  useEffect(() => {
    let mounted = true;
    setNegotiationAssetsLoading(true);
    void otcApiClient
      .getNegotiationAssets({
        country,
        customer: customer ?? null
      })
      .then((assets) => {
        if (!mounted) return;
        setNegotiationAssets(assets);
      })
      .catch(() => {
        if (!mounted) return;
        setNegotiationAssets(brand.backend.negotiationAssetsFallback);
      })
      .finally(() => {
        if (mounted) setNegotiationAssetsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [country, customer, brand.backend.negotiationAssetsFallback]);

  useEffect(() => {
    if (assetOptions.length === 0) return;
    if (assetOptions.some((item) => item.asset === asset)) return;
    setAsset(assetOptions[0].asset);
  }, [assetOptions, asset]);

  useEffect(() => {
    if (!identified || !customer?.documentNumber?.trim()) {
      setTransactionalAllowance(null);
      setTransactionalFetchError(false);
      setTransactionalLoading(false);
      return;
    }

    let cancelled = false;
    setTransactionalLoading(true);
    setTransactionalFetchError(false);

    void otcApiClient
      .getTransactionalAllowance({
        fiatCurrency: brand.fiatCurrency,
        firstName: deriveFirstNameForOtc(customer),
        document: customer.documentNumber.trim(),
        kycResult: mapApprovedKycToCounterpartyPayload(customer.approvedKycResult)
      })
      .then((allowance) => {
        if (!cancelled) {
          setTransactionalAllowance(allowance);
          setTransactionalFetchError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTransactionalAllowance(null);
          setTransactionalFetchError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setTransactionalLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    identified,
    brand.fiatCurrency,
    customer?.documentNumber,
    customer?.approvedKycResult,
    customer?.kycName,
    customer?.fullName,
    customer?.email
  ]);

  const effectiveMaxFiat = useMemo(() => {
    if (identified) {
      if (transactionalAllowance !== null && !transactionalFetchError && !transactionalLoading) {
        return transactionalAllowance.remainingFiat;
      }
      return null;
    }
    return brand.transactionalCapFiat;
  }, [brand.transactionalCapFiat, identified, transactionalAllowance, transactionalFetchError, transactionalLoading]);

  const fiatLegAmount = useMemo(() => {
    if (tradeSide === "buy") {
      return parsedAmount > 0 ? parsedAmount : null;
    }
    return actionableQuote ? actionableQuote.totalFiat : null;
  }, [tradeSide, parsedAmount, actionableQuote]);

  const exceedsLimit =
    fiatLegAmount !== null && effectiveMaxFiat !== null && fiatLegAmount > effectiveMaxFiat + 1e-6;
  const belowMinimumNegotiationValue =
    fiatLegAmount !== null && minNegotiationValueFiat > 0 && fiatLegAmount + 1e-6 < minNegotiationValueFiat;

  const anonymousFlowBlocked =
    !identified &&
    (!parsedAmount ||
      belowMinimumNegotiationValue ||
      exceedsLimit ||
      (tradeSide === "sell" &&
        parsedAmount > 0 &&
        (quoteLoading || !actionableQuote || (effectiveMaxFiat !== null && actionableQuote.totalFiat > effectiveMaxFiat + 1e-6))));

  const transactionalGateBlocksOrder =
    identified &&
    (transactionalLoading ||
      transactionalFetchError ||
      transactionalAllowance === null ||
      belowMinimumNegotiationValue ||
      exceedsLimit);

  const handleBuyPayAmountChange = useCallback(
    (event: { target: { value: string } }) => {
      const raw = event.target.value;
      const normalizedSep = normalizeDecimalInput(raw, 2);
      if (normalizedSep === null) {
        return;
      }
      if (normalizedSep === "" || normalizedSep === ".") {
        setInputAmount(normalizedSep);
        return;
      }
      const parsed = Number(normalizedSep);
      if (!Number.isFinite(parsed)) {
        setInputAmount(normalizedSep);
        return;
      }
      setInputAmount(normalizedSep);
    },
    []
  );

  const selectPayAmountOnFocus = (event: { currentTarget: HTMLInputElement }) => {
    const inputEl = event.currentTarget;
    queueMicrotask(() => {
      inputEl.select();
    });
  };

  async function runWithBlockingUi<T>(task: () => Promise<T>, description?: string) {
    setBlockingUi({
      title: t("common.loading"),
      description
    });
    try {
      return await task();
    } finally {
      setBlockingUi(null);
    }
  }

  const resetOtpState = useCallback(() => {
    setOtpCode("");
    setOtpPreview("");
  }, []);

  const loadPaymentForCurrentContext = async (emailValue: string) => {
    const payment = await otcApiClient.getPaymentData({
      email: emailValue,
      tradeSide,
      asset,
      country
    });
    setPaymentData(payment);
    if (
      (tradeSide === "buy" && payment?.kind === "crypto" && payment.walletAddress && payment.network) ||
      (tradeSide === "sell" && payment?.kind === "bank" && payment.bankKeyValue && payment.bankKeyType)
    ) {
      setPaymentSlotError(null);
    }
  };

  const resetCompanyRepresentativeState = useCallback(() => {
    setCompanyRepresentativeContext(null);
    setSelectedOccupation("");
    setSelectedRepresentativeDocumentType("");
    setSelectedRepresentativeDocumentNumber("");
    setOccupationValidationMessage(null);
    setRepresentativeValidationMessage(null);
    setBiometricIdentityOverride(null);
  }, []);

  const isCompanyDocumentType = useCallback(
    (value: string) => companyDocumentTypes.includes(value.trim()),
    [companyDocumentTypes]
  );

  const openCompanyRepresentativeStep = useCallback(
    (input: {
      companyName?: string | null;
      companyDocumentNumber: string;
      companyDocumentType: string;
      ownersInfo?: CompanyKycOwnerInfo[];
      availableDocumentTypes: string[];
      reason: BiometryReason;
    }) => {
      const allowedPersonalDocumentTypes = input.availableDocumentTypes.filter(
        (doc) => !companyDocumentTypes.includes(doc.trim())
      );
      setCompanyRepresentativeContext({
        companyName: input.companyName ?? null,
        companyDocumentNumber: input.companyDocumentNumber,
        companyDocumentType: input.companyDocumentType,
        ownersInfo: input.ownersInfo ?? []
      });
      setSelectedOccupation("");
      setSelectedRepresentativeDocumentType(allowedPersonalDocumentTypes[0] ?? "");
      setSelectedRepresentativeDocumentNumber("");
      setOccupationValidationMessage(null);
      setRepresentativeValidationMessage(null);
      setBiometricIdentityOverride(null);
      setBiometryReason(input.reason);
      setStep("kyc");
    },
    [companyDocumentTypes]
  );

  const submitCounterpartyKyc = useCallback(
    async (input: { emailValue: string; documentTypeValue: string; documentNumberValue: string }) => {
      return otcApiClient.submitKyc({
        email: input.emailValue,
        documentType: input.documentTypeValue,
        documentNumber: input.documentNumberValue,
        locale,
        country
      });
    },
    [country, locale]
  );

  const syncApprovedCounterpartyKyc = useCallback(
    async (input: {
      emailValue: string;
      documentTypeValue: string;
      documentNumberValue: string;
      kyc: KycSubmitResult;
    }) => {
      await otcApiClient.syncCounterpartyKyc(customer?.email ?? input.emailValue, {
        approvedKycResult: input.kyc.approvedKycResult,
        kycDate: input.kyc.kycDate,
        personType: input.documentTypeValue,
        kycName: input.kyc.kycName,
        birthDate: input.kyc.birthDate,
        documentNumber: input.documentNumberValue,
        failureReasons: input.kyc.failureReasons
      });
    },
    [customer?.email]
  );

  const beginCompanyRepresentativePaymentFlow = useCallback(async () => {
    if (!customer?.email) {
      return;
    }
    const companyDocumentType = (customer.personType ?? customer.documentType ?? "").trim();
    const companyDocumentNumber = normalizeDocumentValue(customer.documentNumber ?? "");
    if (!companyDocumentType || !companyDocumentNumber) {
      alert(t("payment.documentRequired"));
      return;
    }
    const docs = await otcApiClient.getDocumentTypes(country);
    const kyc = await submitCounterpartyKyc({
      emailValue: customer.email,
      documentTypeValue: companyDocumentType,
      documentNumberValue: companyDocumentNumber
    });
    emitFrontendTelemetry("frontend_document_kyc_submitted", {
      kyc_request: {
        email: customer.email,
        document_type: companyDocumentType,
        document_number: companyDocumentNumber,
        reason: "payment_company_revalidation"
      },
      kyc_response: kyc
    });
    if (!kyc.approved) {
      openKycRejectedModal();
      return;
    }
    await syncApprovedCounterpartyKyc({
      emailValue: customer.email,
      documentTypeValue: companyDocumentType,
      documentNumberValue: companyDocumentNumber,
      kyc
    });
    setDocumentTypes(docs);
    setDocumentType(companyDocumentType);
    setDocumentNumber(companyDocumentNumber);
    setPendingKyc(null);
    openCompanyRepresentativeStep({
      companyName: kyc.companyName ?? kyc.kycName,
      companyDocumentNumber,
      companyDocumentType,
      ownersInfo: kyc.ownersInfo,
      availableDocumentTypes: docs,
      reason: "payment"
    });
  }, [country, customer, openCompanyRepresentativeStep, openKycRejectedModal, submitCounterpartyKyc, syncApprovedCounterpartyKyc]);

  const handleDocumentTypeChange = useCallback(
    (value: string) => {
      if (companyRepresentativeContext) {
        resetCompanyRepresentativeState();
      }
      setDocumentType(value);
    },
    [companyRepresentativeContext, resetCompanyRepresentativeState]
  );

  const handleDocumentNumberChange = useCallback(
    (value: string) => {
      if (companyRepresentativeContext) {
        resetCompanyRepresentativeState();
      }
      setDocumentNumber(value);
    },
    [companyRepresentativeContext, resetCompanyRepresentativeState]
  );

  const handleOccupationChange = useCallback(
    (value: string) => {
      setSelectedOccupation(value);
      if (value && !occupationsAvailable.includes(value)) {
        setOccupationValidationMessage(
          t("company.occupationUnavailable").replace("{allowed}", occupationsAvailable.join(", "))
        );
        return;
      }
      setOccupationValidationMessage(null);
    },
    [occupationsAvailable, t]
  );

  const handleRepresentativeDocumentTypeChange = useCallback((value: string) => {
    setSelectedRepresentativeDocumentType(value);
    setRepresentativeValidationMessage(null);
  }, []);

  const handleRepresentativeDocumentNumberChange = useCallback((value: string) => {
    setSelectedRepresentativeDocumentNumber(value);
    setRepresentativeValidationMessage(null);
  }, []);

  const handleCompanyRepresentativeContinue = useCallback(() => {
    if (!companyRepresentativeContext) {
      return;
    }
    if (!selectedOccupation || !occupationsAvailable.includes(selectedOccupation)) {
      setOccupationValidationMessage(
        t("company.occupationUnavailable").replace("{allowed}", occupationsAvailable.join(", "))
      );
      return;
    }
    if (!selectedRepresentativeDocumentType.trim()) {
      setRepresentativeValidationMessage(t("company.representativeDocumentRequired"));
      return;
    }
    const normalizedRepresentativeDocument = normalizeDocumentValue(selectedRepresentativeDocumentNumber);
    const matchedOwner = companyRepresentativeContext.ownersInfo.find((owner) =>
      sameDocumentValue(owner.document, normalizedRepresentativeDocument)
    );
    if (!matchedOwner) {
      setRepresentativeValidationMessage(t("company.representativeNotFound"));
      return;
    }
    setOccupationValidationMessage(null);
    setRepresentativeValidationMessage(null);
    setBiometricIdentityOverride({
      documentNumber: normalizeDocumentValue(matchedOwner.document),
      kycName: matchedOwner.fullName,
      birthDate: matchedOwner.birthDate,
      companyDocumentNumber: companyRepresentativeContext.companyDocumentNumber
    });
    setStep("bio");
  }, [
    companyRepresentativeContext,
    occupationsAvailable,
    selectedOccupation,
    selectedRepresentativeDocumentNumber,
    selectedRepresentativeDocumentType,
    t
  ]);

  const prepareCounterpartyKycStep = async (
    mode: CounterpartyKycMode,
    emailValue: string,
    profileCustomer?: Customer | null
  ) => {
    const docs = await otcApiClient.getDocumentTypes(country);
    const normalizedEmail = emailValue.trim().toLowerCase();
    setEmail(normalizedEmail);
    setDocumentTypes(docs);
    resetCompanyRepresentativeState();
    setDocumentType(profileCustomer?.personType ?? profileCustomer?.documentType ?? docs[0] ?? "");
    setDocumentNumber(profileCustomer?.documentNumber ?? "");
    setCounterpartyKycMode(mode);
    setStep("kyc");
  };

  const loadIdentityContext = async (emailValue: string, source = "unknown") => {
    const profile = await otcApiClient.getProfileAndLimits(emailValue);
    setCustomer(profile.customer);
    setLimits(profile.limits);
    setEmail(profile.customer.email);
    setPendingKyc(null);
    resetCompanyRepresentativeState();
    setDocumentType(profile.customer.personType ?? profile.customer.documentType ?? "");
    setDocumentNumber(profile.customer.documentNumber ?? "");
    setIdentified(true);
    await loadPaymentForCurrentContext(profile.customer.email);
    setStep("none");
    emitFrontendTelemetry(
      "frontend_login_completed",
      {
        source,
        profile,
        loaded_email: profile.customer.email
      },
      {
        userContext: {
          email: profile.customer.email,
          document: profile.customer.documentNumber ?? "",
          document_type: profile.customer.personType ?? profile.customer.documentType ?? ""
        }
      }
    );
    return profile;
  };

  const openPaymentModal = async () => {
    await runWithBlockingUi(async () => {
      if (tradeSide === "buy") {
        const networks = await otcApiClient.getNetworksAndFees(country, asset);
        setNetworksAndFees(networks);
        setNetwork(paymentData?.network ?? networks[0]?.network ?? "");
        setWalletAddress(paymentData?.walletAddress ?? "");
      } else {
        setBankKeyType(paymentData?.bankKeyType ?? "Telefone");
        setBankKeyValue(paymentData?.bankKeyValue ?? "");
      }
      setStep("payment");
    }, t("loading.fetchingPayment"));
  };

  const handlePaymentAction = async () => {
    if (!customer) return;
    setPaymentSlotError(null);
    if (!sessionBiometryDone) {
      paymentBiometryDocRetryConsumedRef.current = false;
      if (isCompanyDocumentType(customer.personType ?? customer.documentType ?? "")) {
        await runWithBlockingUi(beginCompanyRepresentativePaymentFlow, t("loading.validatingIdentity"));
        return;
      }
      setBiometricIdentityOverride(null);
      setBiometryReason("payment");
      setStep("bio");
      return;
    }
    await openPaymentModal();
  };

  useEffect(() => {
    pricingSnapRef.current = null;
    lastPricingSuccessKeyRef.current = "";
    setQuote(null);
    void refreshQuote();
    const timer = window.setInterval(() => void refreshQuote(), 20_000);
    return () => window.clearInterval(timer);
  }, [quoteStructuralKey, refreshQuote]);

  useEffect(() => {
    if (!customer?.email) return;
    loadPaymentForCurrentContext(customer.email);
  }, [customer?.email, tradeSide, asset, country]);

  useEffect(() => {
    if (!identified || tradeSide !== "buy") {
      setNetworksAndFees([]);
      setNetworksAndFeesLoading(false);
      return;
    }
    let mounted = true;
    setNetworksAndFeesLoading(true);
    const loadNetworks = async () => {
      try {
        const networks = await otcApiClient.getNetworksAndFees(country, asset);
        if (!mounted) return;
        setNetworksAndFees(networks);
      } finally {
        if (mounted) setNetworksAndFeesLoading(false);
      }
    };
    void loadNetworks();
    return () => {
      mounted = false;
    };
  }, [identified, tradeSide, country, asset]);

  useEffect(() => {
    if (step !== "bio") {
      bioAutostartedRef.current = false;
      return;
    }
    if (bioAutostartedRef.current) return;
    bioAutostartedRef.current = true;
    void handleBiometric();
  }, [step]);

  const handleEmailLookup = async () => {
    if (!email) return;
    await runWithBlockingUi(async () => {
      const lookup = await otcApiClient.lookupCustomerByEmail(email);
      const hasStoredApprovedKyc = hasApprovedCounterpartyKyc(lookup.customer?.approvedKycResult);
      const requiresStoredKycRefresh = hasExpiredCounterpartyKyc(lookup.customer ?? null, brand.backend.otcKycValidityDays);

      if (lookup.customer && (lookup.exists || !hasStoredApprovedKyc || requiresStoredKycRefresh)) {
        const profile = await loadIdentityContext(lookup.customer.email, "existing_lookup");
        if (!hasApprovedCounterpartyKyc(profile.customer.approvedKycResult)) {
          setIdentified(false);
          setStep("none");
          alert(t("kyc.internalBlocked"));
          return;
        }
        if (hasExpiredCounterpartyKyc(profile.customer, brand.backend.otcKycValidityDays)) {
          setIdentified(false);
          await prepareCounterpartyKycStep("refresh", profile.customer.email, profile.customer);
          alert(t("kyc.refreshRequired"));
          return;
        }
        return;
      }
      setPendingKyc(null);
      const send = await otcApiClient.sendOtp(email, Date.now());
      emitFrontendTelemetry("frontend_email_unregistered", {
        lookup_response: lookup,
        send_otp_response: send
      });
      resetOtpState();
      setOtpPreview(send.codePreview);
      setStep("otp");
    }, t("loading.checkingEmail"));
  };

  const handleOtpVerify = async () => {
    await runWithBlockingUi(async () => {
      const result = await otcApiClient.verifyOtp(email, otpCode);
      if (!result.ok) {
        alert(t("otp.invalid"));
        return;
      }
      resetOtpState();
      await prepareCounterpartyKycStep("onboarding", email);
    }, t("loading.verifyingCode"));
  };

  const handleKyc = async () => {
    await runWithBlockingUi(async () => {
      const normalizedDocument = normalizeDocumentValue(documentNumber);
      const normalizedPersonType = documentType.trim();
      const kyc = await submitCounterpartyKyc({
        emailValue: email,
        documentTypeValue: normalizedPersonType,
        documentNumberValue: normalizedDocument
      });
      emitFrontendTelemetry("frontend_document_kyc_submitted", {
        kyc_request: {
          email,
          document_type: normalizedPersonType,
          document_number: normalizedDocument
        },
        kyc_response: kyc
      });
      if (!kyc.approved) {
        setIdentified(false);
        openKycRejectedModal();
        return;
      }
      await syncApprovedCounterpartyKyc({
        emailValue: email,
        documentTypeValue: normalizedPersonType,
        documentNumberValue: normalizedDocument,
        kyc
      });
      if (counterpartyKycMode === "refresh") {
        await loadIdentityContext(customer?.email ?? email, "kyc_refresh");
        return;
      }
      setPendingKyc({
        approvedKycResult: kyc.approvedKycResult,
        kycDate: kyc.kycDate,
        personType: normalizedPersonType,
        kycName: kyc.kycName,
        birthDate: kyc.birthDate,
        documentNumber: normalizedDocument
      });
      if (isCompanyDocumentType(normalizedPersonType)) {
        openCompanyRepresentativeStep({
          companyName: kyc.companyName ?? kyc.kycName,
          companyDocumentNumber: normalizedDocument,
          companyDocumentType: normalizedPersonType,
          ownersInfo: kyc.ownersInfo,
          availableDocumentTypes: documentTypes,
          reason: "onboarding"
        });
        return;
      }
      setBiometricIdentityOverride(null);
      setBiometryReason("onboarding");
      setStep("bio");
    }, t("loading.validatingIdentity"));
  };

  const handleBiometric = async () => {
    const targetEmail = customer?.email ?? email;
    const targetDocument =
      biometricIdentityOverride?.documentNumber ?? customer?.documentNumber ?? pendingKyc?.documentNumber ?? documentNumber;
    if (!targetDocument) {
      alert(t("payment.documentRequired"));
      return;
    }

    try {
      setBlockingUi({
        title: t("common.loading"),
        description: t("loading.startingBiometry")
      });
      setStep("none");
      let verificationOpened = false;
      const biometric = await startBiometricSession({
        email: targetEmail,
        documentNumber: targetDocument,
        locale,
        reason: biometryReason,
        kycName: biometricIdentityOverride?.kycName ?? pendingKyc?.kycName ?? customer?.kycName ?? customer?.fullName ?? null,
        birthDate: biometricIdentityOverride?.birthDate ?? pendingKyc?.birthDate ?? customer?.birthDate ?? null,
        companyDocumentNumber: biometricIdentityOverride?.companyDocumentNumber ?? null,
        lastSuccessfulBiometric: customer?.lastSuccessfulBiometric ?? null,
        onVerificationOpened: () => {
          verificationOpened = true;
          setBlockingUi(null);
        }
      });
      if (!verificationOpened) {
        setBlockingUi(null);
      }

      emitFrontendTelemetry("frontend_biometry_status_updated", {
        target_email: targetEmail,
        target_document: targetDocument,
        biometric_result: biometric
      });

      if (!biometric.approved) {
        if (biometric.errorCode === "cancelled") {
          paymentBiometryDocRetryConsumedRef.current = false;
          alert(t("biometry.cancelled"));
          return;
        }
        if (biometric.errorCode === "document_verification_missing" || biometric.errorCode === "portrait_missing") {
          if (biometryReason === "payment") {
            if (!paymentBiometryDocRetryConsumedRef.current) {
              paymentBiometryDocRetryConsumedRef.current = true;
              void handleBiometric();
              return;
            }
            paymentBiometryDocRetryConsumedRef.current = false;
            setStep("bio");
            return;
          }
          alert(t("biometry.documentVerificationMissing"));
          return;
        }
        if (biometric.sessionStatus === "In Review" || biometric.sessionStatus === "Pending") {
          if (biometryReason === "payment") {
            paymentBiometryDocRetryConsumedRef.current = false;
          }
          alert(t("biometry.pendingReview"));
          return;
        }
        if (biometryReason === "payment") {
          paymentBiometryDocRetryConsumedRef.current = false;
        }
        alert(t("biometry.rejected"));
        return;
      }

      const approvedAt = Date.now();
      paymentBiometryDocRetryConsumedRef.current = false;
      setSessionBiometryDone(true);

      if (biometryReason === "onboarding") {
        if (!pendingKyc) {
          return;
        }

        setBlockingUi({
          title: t("common.loading"),
          description: t("loading.finishingRegistration")
        });
        await otcApiClient.finalizeApprovedCustomerOnboarding({
          email: targetEmail,
          documentNumber: pendingKyc.documentNumber,
          personType: pendingKyc.personType,
          kycName: pendingKyc.kycName,
          birthDate: pendingKyc.birthDate,
          approvedKycResult: pendingKyc.approvedKycResult,
          kycDate: pendingKyc.kycDate,
          lastSuccessfulBiometric: approvedAt,
          emailVerified: true
        });
        await loadIdentityContext(targetEmail, "onboarding_completed");
        resetCompanyRepresentativeState();
        setBlockingUi(null);
        return;
      }

      setBlockingUi({
        title: t("common.loading"),
        description: t("loading.finishingRegistration")
      });
      const updatedCustomer = await otcApiClient.syncApprovedBiometric(targetEmail, approvedAt);
      if (updatedCustomer) {
        setCustomer(updatedCustomer);
      }
      resetCompanyRepresentativeState();
      await openPaymentModal();
      setBlockingUi(null);
    } catch {
      emitFrontendTelemetry("frontend_biometry_status_updated", {
        target_email: targetEmail,
        target_document: targetDocument,
        biometric_result: {
          approved: false,
          provider: "Didit SDK",
          error_code: "sdk_error"
        }
      });
      setBlockingUi(null);
      if (biometryReason === "payment") {
        paymentBiometryDocRetryConsumedRef.current = false;
      }
      alert(t("biometry.sdkError"));
    }
  };

  const handleSavePayment = async () => {
    if (!customer?.documentNumber) {
      alert(t("payment.documentRequired"));
      return;
    }

    await runWithBlockingUi(async () => {
      const customerDocument = customer.documentNumber;
      if (!customerDocument) {
        return;
      }
      if (tradeSide === "buy") {
        if (!walletAddress.trim() || !network.trim()) {
          return;
        }
        const check = await otcApiClient.walletKytCheck(walletAddress.trim(), network.trim());
        if (!check.approved) {
          alert(t("payment.kytRejected"));
          return;
        }
        const payload: PaymentData = {
          email: customer.email,
          tradeSide,
          asset,
          country,
          kind: "crypto",
          network,
          walletAddress
        };
        await otcApiClient.savePaymentData(payload);
        emitFrontendTelemetry("frontend_wallet_saved", {
          payment_kind: "crypto",
          is_update: Boolean(paymentData),
          risk_check: check,
          saved_payment_data: payload
        });
        setPaymentData(payload);
        setPaymentSlotError(null);
        setStep("none");
        return;
      }

      const owner = await otcApiClient.bankKeyOwnerCheck(bankKeyValue, customerDocument);
      if (!owner.approved) {
        alert(t("payment.ownerRejected"));
        return;
      }
      const payload: PaymentData = {
        email: customer.email,
        tradeSide,
        asset,
        country,
        kind: "bank",
        bankKeyType,
        bankKeyValue
      };
      await otcApiClient.savePaymentData(payload);
      emitFrontendTelemetry("frontend_wallet_saved", {
        payment_kind: "bank",
        is_update: Boolean(paymentData),
        owner_check: owner,
        saved_payment_data: payload
      });
      setPaymentData(payload);
      setPaymentSlotError(null);
      setStep("none");
    }, t("loading.savingPayment"));
  };

  const createOrderNow = async () => {
    if (!actionableQuote || !customer || !paymentData || !hasPaymentReady || !parsedAmount) return;
    if (!transactionalAllowance || transactionalFetchError || transactionalLoading) return;
    if (tradeSide !== "buy" || paymentData.kind !== "crypto" || !paymentData.walletAddress || !paymentData.network) return;
    if (effectiveMaxFiat === null) return;
    const fiatLeg = tradeSide === "buy" ? parsedAmount : actionableQuote.totalFiat;
    if (fiatLeg + 1e-6 < minNegotiationValueFiat) return;
    if (fiatLeg > effectiveMaxFiat + 1e-6) return;
    const orderTab = window.open("", "_blank");
    if (!orderTab) {
      alert("Não foi possível abrir a tela do pedido. Verifique o bloqueador de pop-up.");
      return;
    }
    orderTab.document.open();
    orderTab.document.write(createOrderLoadingDocument(brand));
    orderTab.document.close();

    try {
      const document = customer.documentNumber?.trim();
      const documentType = customer.personType ?? customer.documentType ?? "";
      const kycName = customer.kycName ?? customer.fullName ?? "";
      const kycTs = customer.kycDate ?? 0;
      if (!document || !documentType || !kycName || !kycTs || !hasApprovedCounterpartyKyc(customer.approvedKycResult)) {
        orderTab.close();
        alert(t("kyc.internalBlocked"));
        return;
      }

      const buildQuoteRequest = (): QuoteRequest => ({
        tradeSide,
        asset,
        amount: parsedAmount,
        coupon: appliedCoupon.trim() || undefined,
        country,
        locale,
        customer
      });
      const paymentInfo = {
        wallet: paymentData.walletAddress,
        network: paymentData.network
      };

      let preOrder = await otcApiClient.preValidateOrder({
        asset,
        tradeType: "BUY",
        coupon: appliedCoupon.trim() || undefined,
        paymentInfo,
        price: actionableQuote.unitPrice,
        amount: parsedAmount,
        document,
        documentType
      });

      if (!preOrder.priceIsValid) {
        const nextValidPrice = preOrder.currentValidPrice ?? preOrder.price;
        if (!(nextValidPrice > 0)) {
          orderTab.close();
          alert(t("order.validationFailed"));
          return;
        }
        pricingSnapRef.current = {
          standardUnitPrice: nextValidPrice,
          finalUnitPrice: nextValidPrice,
          couponIsValid: preOrder.couponIsValid,
          fetchedAtIso: new Date().toISOString(),
          tradeSide,
          asset,
          locale,
          country,
          pricingIdentityKey
        };
        setQuote(deriveQuoteResponseFromUnitPrice(buildQuoteRequest(), nextValidPrice));
        const confirmed = window.confirm(t("order.priceChangedConfirm"));
        if (!confirmed) {
          orderTab.close();
          return;
        }
        preOrder = await otcApiClient.preValidateOrder({
          asset,
          tradeType: "BUY",
          coupon: appliedCoupon.trim() || undefined,
          paymentInfo,
          price: nextValidPrice,
          amount: parsedAmount,
          document,
          documentType
        });
        if (!preOrder.priceIsValid) {
          orderTab.close();
          alert(t("order.validationFailed"));
          return;
        }
      }

      const order = await otcApiClient.createOrder({
        email: customer.email,
        country,
        asset,
        assetToPay: brand.backend.localPaymentAssetByCountry[country] ?? brand.fiatCurrency,
        tradeType: "BUY",
        coupon: appliedCoupon.trim() || undefined,
        paymentInfo,
        price: preOrder.price,
        amount: parsedAmount,
        document,
        documentType,
        kycInfo: {
          name: kycName,
          kycResult: mapApprovedKycToCounterpartyPayload(customer.approvedKycResult),
          kycTs
        },
        preOrder
      });
      emitFrontendTelemetry("frontend_order_created", {
        order_request: {
          email: customer.email,
          country,
          asset,
          asset_to_pay: brand.backend.localPaymentAssetByCountry[country] ?? brand.fiatCurrency,
          trade_type: "BUY",
          coupon: appliedCoupon.trim() || undefined,
          payment_info: paymentInfo,
          price: preOrder.price,
          amount: parsedAmount,
          document,
          document_type: documentType,
          kyc_info: {
            name: kycName,
            kyc_result: mapApprovedKycToCounterpartyPayload(customer.approvedKycResult),
            kyc_ts: kycTs
          },
          pre_order: preOrder
        },
        order_response: order
      });
      setWindowOrderPayload(orderTab, order);
      orderTab.location.href = `/order/${encodeURIComponent(order.id)}`;
    } catch (error) {
      orderTab.document.open();
      orderTab.document.write(
        createOrderStatusMessageDocument(brand, {
          title: brand.orderPage.texts.title,
          message: brand.orderPage.texts.serverUnavailable
        })
      );
      orderTab.document.close();
      throw error;
    }
  };

  const handleConfirmOrder = async () => {
    emitFrontendTelemetry("frontend_confirm_order_clicked", {
      confirm_blocked_by_missing_wallet: identified && tradeSide === "buy" && !hasPaymentReady,
      actionable_quote: actionableQuote,
      quote_is_expired: quoteIsExpired,
      has_payment_ready: hasPaymentReady,
      transactional_gate_blocked: transactionalGateBlocksOrder
    });
    if (identified && tradeSide === "buy" && !hasPaymentReady) {
      setPaymentSlotError(t("form.walletRequiredBeforeConfirm"));
      return;
    }
    setPaymentSlotError(null);
    if (identified) {
      await createOrderNow();
      return;
    }
    openEmailModal();
  };

  const quoteMissingLabel = t("quote.unavailable");
  const paymentLabel = tradeSide === "buy" ? `${t("app.paymentData")} (${asset})` : `${t("app.paymentData")} (${bankLabel})`;

  const paymentSummary =
    tradeSide === "buy"
      ? paymentData?.walletAddress && paymentData.network
        ? `${paymentData.network} - ${maskWallet(paymentData.walletAddress)}`
        : null
      : paymentData?.bankKeyValue && paymentData.bankKeyType
        ? `${paymentData.bankKeyType} - ${maskBankKey(paymentData.bankKeyValue)}`
        : null;

  const paymentMissingText = tradeSide === "buy" ? t("form.notFoundWallet") : t("form.notFoundBankKey");
  const hasPaymentReady =
    tradeSide === "buy"
      ? Boolean(paymentData?.walletAddress && paymentData.network)
      : Boolean(paymentData?.bankKeyValue && paymentData.bankKeyType);
  const showPaymentSlotError = tradeSide === "buy" && Boolean(paymentSlotError);
  const selectedNetworkOption =
    tradeSide === "buy" && paymentData?.walletAddress && paymentData.network
      ? findWithdrawNetworkByCode(networksAndFees, paymentData.network) ?? null
      : null;
  const selectedNetworkFeeBrl = selectedNetworkOption?.withdrawFeeBrlEstimate ?? null;
  const receiveAmount =
    actionableQuote && tradeSide === "buy"
      ? Math.max(actionableQuote.outputAmount - (selectedNetworkOption?.withdrawFee ?? 0), 0)
      : actionableQuote?.outputAmount ?? null;
  const outputText =
    actionableQuote && tradeSide === "buy"
      ? formatAssetQuoteAmount(receiveAmount ?? 0, assetDecimalPrecision)
      : actionableQuote
        ? actionableQuote.outputAmount.toFixed(Math.max(0, fiatDecimalPrecision))
        : parsedAmount > 0
          ? quoteMissingLabel
          : "0";
  const couponInputTrimmed = couponInput.trim();
  const appliedCouponTrimmed = appliedCoupon.trim();
  const couponDirty = couponInputTrimmed !== appliedCouponTrimmed;
  const hasCouponDiscount =
    !!actionableQuote && Math.abs(actionableQuote.standardUnitPrice - actionableQuote.finalUnitPrice) > Number.EPSILON;
  const ratePriceText = (amount: number) => amount.toFixed(Math.max(0, fiatDecimalPrecision));
  const rateText = actionableQuote ? (
    hasCouponDiscount ? (
      <>
        <span className="quote-rate">{`1 ${asset} ≈ `}</span>
        <span className="quote-rate quote-rate--discounted">
          <s>{`${ratePriceText(actionableQuote.standardUnitPrice)} `}</s>
        </span>
        <span className="quote-rate">{`${ratePriceText(actionableQuote.finalUnitPrice)} ${brand.fiatCurrency}`}</span>
      </>
    ) : (
      <span className="quote-rate">{`1 ${asset} ≈ ${ratePriceText(actionableQuote.finalUnitPrice)} ${brand.fiatCurrency}`}</span>
    )
  ) : parsedAmount > 0 ? (
    `1 ${asset} ≈ ${quoteMissingLabel} ${brand.fiatCurrency}`
  ) : (
    `1 ${asset} ≈ 0 ${brand.fiatCurrency}`
  );
  const couponVisualState =
    !couponDirty && appliedCouponTrimmed
      ? couponFeedback === "valid"
        ? "success"
        : couponFeedback === "invalid"
          ? "error"
          : "idle"
      : "idle";
  const couponMessage =
    !couponDirty && appliedCouponTrimmed
      ? couponFeedback === "valid"
        ? t("coupon.valid")
        : couponFeedback === "invalid"
          ? t("coupon.invalid")
          : null
      : null;
  const limitMessage =
    belowMinimumNegotiationValue
      ? t("limits.belowMinimum").replace("{min}", formatFiatAmount(locale, brand.fiatCurrency, minNegotiationValueFiat))
      : exceedsLimit && effectiveMaxFiat !== null
        ? t("limits.exceeded").replace("{max}", formatFiatAmount(locale, brand.fiatCurrency, effectiveMaxFiat))
        : null;
  const payFieldHasError = belowMinimumNegotiationValue || exceedsLimit;
  const openEmailModal = () => {
    resetOtpState();
    setStep("email");
  };
  const applyCoupon = useCallback(() => {
    const nextCoupon = couponInput.trim();
    setAppliedCoupon(nextCoupon);
    setCouponFeedback("idle");
  }, [couponInput]);

  const resetFlowState = useCallback(() => {
    setStep("none");
    setTradeSide("buy");
    setAsset("USDT");
    setInputAmount("100");
    setCouponInput("");
    setAppliedCoupon("");
    setCouponFeedback("idle");
    setQuote(null);
    lastPricingSuccessKeyRef.current = "";
    pricingSnapRef.current = null;
    setQuoteLoading(false);
    setEmail("");
    resetOtpState();
    setBiometryReason("onboarding");
    setCounterpartyKycMode("onboarding");
    setSessionBiometryDone(false);
    setIdentified(false);
    setCustomer(null);
    setLimits(null);
    setTransactionalAllowance(null);
    setTransactionalLoading(false);
    setTransactionalFetchError(false);
    setPaymentData(null);
    setPaymentSlotError(null);
    setPendingKyc(null);
    setDocumentType("");
    setDocumentNumber("");
    setDocumentTypes([]);
    resetCompanyRepresentativeState();
    setKycRejectedModalOpen(false);
    setNetwork("");
    setWalletAddress("");
    setBankKeyType("Telefone");
    setBankKeyValue("");
    setNetworksAndFees([]);
    setNetworksAndFeesLoading(false);
  }, [resetCompanyRepresentativeState, resetOtpState]);

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current !== null) {
      window.clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = window.setTimeout(() => {
      resetFlowState();
    }, INACTIVITY_TIMEOUT_MS);
  }, [resetFlowState]);

  const resetIdentity = () => {
    resetFlowState();
    resetInactivityTimer();
  };

  useEffect(() => {
    const activityEvents: Array<keyof DocumentEventMap> = ["pointerdown", "keydown", "input"];
    const handleActivity = () => {
      resetInactivityTimer();
    };

    resetInactivityTimer();

    activityEvents.forEach((eventName) => {
      document.addEventListener(eventName, handleActivity, true);
    });

    return () => {
      activityEvents.forEach((eventName) => {
        document.removeEventListener(eventName, handleActivity, true);
      });
      if (inactivityTimerRef.current !== null) {
        window.clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [resetInactivityTimer]);

  return (
    <div className="home-shell">
      <header className="top-nav">
        <div className="top-nav__logo">
          {brand.logoUrl ? (
            <img className="logo-image" src={brand.logoUrl} alt={brand.companyName} />
          ) : (
            <span className="logo-mark">{t("nav.logo")}</span>
          )}
        </div>
        <div className="top-nav__actions">
          {customer?.email ? (
            <>
              <span className="active-email">
                {t("nav.activeEmail")}: {customer.email}
              </span>
              <button type="button" className="nav-button nav-button--ghost" onClick={resetIdentity}>
                {t("nav.logout")}
              </button>
            </>
          ) : (
            <button type="button" className="nav-button nav-button--ghost" onClick={openEmailModal}>
              {t("nav.login")}
            </button>
          )}
        </div>
      </header>

      <div className="page">
        <section className="promo-column">
          <div className="promo-copy">
            <h1>{brand.headline || t("app.title")}</h1>
            <p>{brand.subheadline || t("app.subtitle")}</p>
            {brand.secondarySubheadline ? <p>{brand.secondarySubheadline}</p> : null}
          </div>

          <ul className="benefits promo-benefits">
            <li>
              <span className="benefit-dot">✓</span>
              <span>{t("app.noHiddenFees")}</span>
            </li>
            <li>
              <span className="benefit-dot">✓</span>
              <span>{t("app.timing")}</span>
            </li>
          </ul>

          <div className="promo-footer">
            <small>{brand.legalDisclaimer}</small>
          </div>
        </section>

        <section className="form-column">
          <section className="trade-card">
            <div className="trade-form">
              <div className="tab-switcher">
                <button
                  type="button"
                  className={`tab-button ${tradeSide === "buy" ? "active" : ""}`}
                  onClick={() => setTradeSide("buy")}
                >
                  {t("trade.buy")}
                </button>
                <button
                  type="button"
                  className={`tab-button ${tradeSide === "sell" ? "active" : ""}`}
                  onClick={() => setTradeSide("sell")}
                >
                  {t("trade.sell")}
                </button>
                <div className={`tab-indicator ${tradeSide === "sell" ? "sell" : ""}`} />
              </div>
              {tradeTypeUnavailable ? (
                <div className="trade-unavailable-message">{tradeUnavailableMessage}</div>
              ) : (
                <>
                  <div className="row">
                    <label>{t("app.pay")}</label>
                    <div className={`field-shell ${payFieldHasError ? "field-shell--error" : ""}`}>
                      {tradeSide === "buy" ? (
                        <>
                          <span className="currency-pill">{brand.fiatCurrency}</span>
                          <input
                            className="amount-input"
                            inputMode="decimal"
                            value={inputAmount}
                            onChange={handleBuyPayAmountChange}
                            onFocus={selectPayAmountOnFocus}
                          />
                        </>
                      ) : (
                        <>
                          <select value={asset} onChange={(e) => setAsset(e.target.value)} disabled={negotiationAssetsLoading || assetOptions.length === 0}>
                            {assetOptions.map((option) => (
                              <option key={option.asset} value={option.asset}>
                                {option.asset}
                              </option>
                            ))}
                          </select>
                          <input
                            className="amount-input"
                            inputMode="decimal"
                            value={inputAmount}
                            onChange={(e) => {
                              const normalized = normalizeDecimalInput(e.target.value, 2);
                              if (normalized !== null) {
                                setInputAmount(normalized);
                              }
                            }}
                            onFocus={selectPayAmountOnFocus}
                          />
                        </>
                      )}
                    </div>
                    {limitMessage ? <p className="field-feedback field-feedback--error">{limitMessage}</p> : null}
                  </div>

                  <div className="row">
                    <label>{t("app.receive")}</label>
                    <div className="field-shell">
                      {tradeSide === "buy" ? (
                        <>
                          <select value={asset} onChange={(e) => setAsset(e.target.value)} disabled={negotiationAssetsLoading || assetOptions.length === 0}>
                            {assetOptions.map((option) => (
                              <option key={option.asset} value={option.asset}>
                                {option.asset}
                              </option>
                            ))}
                          </select>
                          <div className="field-output">{outputText}</div>
                        </>
                      ) : (
                        <>
                          <span className="currency-pill">{brand.fiatCurrency}</span>
                          <div className="field-output">{outputText}</div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="quote-inline-summary">
                    <p className="quote-bad">{quoteLoading ? t("common.loading") : t("quote.willUpdate")}</p>

                    <div className="quote-line">
                      <span>{rateText}</span>
                      <span>
                        {t("quote.updatedAt")}:{" "}
                        {actionableQuote ? new Date(actionableQuote.updatedAt).toLocaleTimeString() : "--:--"}
                      </span>
                    </div>

                  </div>

                  {identified && transactionalLoading ? (
                    <p className="quote-line transactional-limit-msg">{t("limits.loading")}</p>
                  ) : null}
                  {identified && !transactionalLoading && transactionalFetchError ? (
                    <p className="field-feedback field-feedback--error">{t("limits.loadError")}</p>
                  ) : null}

                  <details className="details-card">
                    <summary>{t("app.details")}</summary>
                    <div className="details-content">
                      <div className="quote-mobile-summary">
                        <div className="details-row">
                          <strong>{quoteLoading ? t("common.loading") : t("quote.willUpdate")}</strong>
                          <span>{rateText}</span>
                        </div>
                        <div className="details-row">
                          <strong>{t("quote.updatedAt")}</strong>
                          <span>{actionableQuote ? new Date(actionableQuote.updatedAt).toLocaleTimeString() : "--:--"}</span>
                        </div>
                      </div>
                      {identified && tradeSide === "buy" && hasPaymentReady ? (
                        <div className="details-row">
                          <strong>{t("common.networkFee")}</strong>
                          <span>
                            {networksAndFeesLoading
                              ? t("common.loading")
                              : selectedNetworkOption
                                ? `${formatNetworkFeeAmount(selectedNetworkOption.withdrawFee)} ${asset}${
                                    selectedNetworkFeeBrl !== null && selectedNetworkFeeBrl !== undefined
                                      ? ` (${formatFiatAmountWithPrecision(locale, brand.fiatCurrency, selectedNetworkFeeBrl, fiatDecimalPrecision)})`
                                      : ""
                                  }`
                                : quoteMissingLabel}
                          </span>
                        </div>
                      ) : null}
                      <div className="details-row details-row--effective-rate">
                        <strong>{t("common.rate")}</strong>
                        <span>{rateText}</span>
                      </div>
                    </div>
                  </details>

                  <div className={`coupon-row coupon-row--${couponVisualState}`}>
                    <div className={`coupon-input-shell coupon-input-shell--${couponVisualState}`}>
                      <input
                        placeholder={t("form.coupon")}
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value)}
                      />
                      <button
                        type="button"
                        className="coupon-apply-button"
                        onClick={applyCoupon}
                        disabled={quoteLoading && appliedCouponTrimmed === couponInputTrimmed}
                      >
                        {t("coupon.apply")}
                      </button>
                    </div>
                    {couponMessage ? <p className={`coupon-feedback coupon-feedback--${couponVisualState}`}>{couponMessage}</p> : null}
                  </div>

                  {identified && paymentContext && (
                    <div className={`payment-slot${showPaymentSlotError ? " payment-slot--error" : ""}`}>
                      <div>
                        <strong>{paymentLabel}</strong>
                        <span>{paymentSummary ?? paymentMissingText}</span>
                        {showPaymentSlotError ? <p className="field-feedback field-feedback--error">{paymentSlotError}</p> : null}
                      </div>
                      <div className="payment-slot-actions">
                        <button type="button" className="icon-button" onClick={handlePaymentAction}>
                          {paymentSummary ? t("form.edit") : t("form.add")}
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleConfirmOrder}
                    disabled={
                      identified
                        ? !actionableQuote || !parsedAmount || transactionalGateBlocksOrder
                        : anonymousFlowBlocked
                    }
                  >
                    {identified ? t("form.confirmOrder") : t("form.continue")}
                  </button>
                </>
              )}
            </div>
          </section>
        </section>
      </div>

      {hasFooterContent ? (
        <footer className="home-page-footer">
          <section className="home-contact-footer" style={footerWrapperStyle}>
            <div className="home-contact-footer__inner">
              {brand.footer.title ? (
                <h2 className="home-contact-footer__title" style={footerTitleStyle}>
                  {brand.footer.title}
                </h2>
              ) : null}
              {brand.footer.description ? (
                <p className="home-contact-footer__description" style={footerDescriptionStyle}>
                  {brand.footer.description}
                </p>
              ) : null}
              {footerContacts.length ? (
                <div className="home-contact-footer__contacts">
                  {footerContacts.map((contact) => (
                    <a
                      key={contact.kind}
                      className="home-contact-footer__contact"
                      href={contact.href}
                      style={footerContactStyle}
                      target={contact.openInNewTab ? "_blank" : undefined}
                      rel={contact.openInNewTab ? "noreferrer" : undefined}
                    >
                      <span className="home-contact-footer__icon" style={footerIconStyle}>
                        {renderFooterContactIcon(contact.kind)}
                      </span>
                      <span className="home-contact-footer__contact-text">
                        <span>{contact.value}</span>
                      </span>
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        </footer>
      ) : null}

      <Modal
        open={step === "email"}
        title={t("modal.email.title")}
        onClose={() => {
          resetOtpState();
          setStep("none");
        }}
      >
        <div className="modal-body modal-body--form">
          <p className="modal-description">{t("modal.email.description")}</p>
          <div className="modal-field">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.com" />
          </div>
          <div className="modal-actions">
            <button type="button" className="primary-button modal-primary-button" onClick={handleEmailLookup}>
              {t("common.confirm")}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={step === "otp"}
        title={t("modal.otp.title")}
        onClose={() => {
          resetOtpState();
          setStep("none");
        }}
      >
        <div className="modal-body modal-body--form">
          <p className="modal-description">{t("modal.otp.description")}</p>
          {otpPreview ? <p className="modal-helper">{t("otp.preview")}: {otpPreview}</p> : null}
          <div className="modal-field">
            <input className="otp-input" value={otpCode} onChange={(e) => setOtpCode(e.target.value)} maxLength={6} autoComplete="off" />
          </div>
          <div className="modal-actions">
            <button type="button" className="primary-button modal-primary-button" onClick={handleOtpVerify}>
              {t("common.confirm")}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={step === "kyc"}
        title={t("modal.kyc.title")}
        onClose={() => {
          resetCompanyRepresentativeState();
          setStep("none");
        }}
      >
        <div className="modal-body modal-body--form">
          <p className="modal-description">
            {isCompanyRepresentativeStep ? t("modal.kyc.companyDescription") : t("modal.kyc.description")}
          </p>
          <div className="modal-field">
            <label>{t("common.document")}</label>
            <div className="field-shell modal-document-shell">
              <select
                value={documentType}
                disabled={isCompanyRepresentativeStep}
                onChange={(e: { target: { value: string } }) => handleDocumentTypeChange(e.target.value)}
              >
                {documentTypes.map((doc: string) => (
                  <option key={doc} value={doc}>
                    {doc}
                  </option>
                ))}
              </select>
              <input
                value={documentNumber}
                disabled={isCompanyRepresentativeStep}
                onChange={(e: { target: { value: string } }) => handleDocumentNumberChange(e.target.value)}
              />
            </div>
          </div>
          {companyRepresentativeContext ? (
            <>
              <div className="modal-section-title">{t("company.representativeSectionTitle")}</div>
              <div className={`modal-field${occupationValidationMessage ? " modal-field--error" : ""}`}>
                <label>{t("company.occupation")}</label>
                <select value={selectedOccupation} onChange={(e: { target: { value: string } }) => handleOccupationChange(e.target.value)}>
                  <option value="">{t("company.occupationPlaceholder")}</option>
                  {occupations.map((occupation) => (
                    <option key={occupation} value={occupation}>
                      {occupation}
                    </option>
                  ))}
                </select>
                {occupationValidationMessage ? <p className="modal-field-error">{occupationValidationMessage}</p> : null}
              </div>
              <div className={`modal-field${representativeValidationMessage ? " modal-field--error" : ""}`}>
                <label>{t("company.representativeDocument")}</label>
                <div className="field-shell modal-document-shell">
                  <select
                    value={selectedRepresentativeDocumentType}
                    onChange={(e: { target: { value: string } }) => handleRepresentativeDocumentTypeChange(e.target.value)}
                  >
                    {personalDocumentTypes.map((doc) => (
                      <option key={doc} value={doc}>
                        {doc}
                      </option>
                    ))}
                  </select>
                  <input
                    value={selectedRepresentativeDocumentNumber}
                    onChange={(e: { target: { value: string } }) => handleRepresentativeDocumentNumberChange(e.target.value)}
                  />
                </div>
                {representativeValidationMessage ? <p className="modal-field-error">{representativeValidationMessage}</p> : null}
              </div>
            </>
          ) : null}
          <div className="modal-actions">
            <button
              type="button"
              className="primary-button modal-primary-button"
              onClick={companyRepresentativeContext ? handleCompanyRepresentativeContinue : handleKyc}
            >
              {t("common.confirm")}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={kycRejectedModalOpen} title="Solicitação não aprovada" onClose={() => setKycRejectedModalOpen(false)}>
        <div className="modal-body modal-body--form">
          <p className="modal-description modal-description--preline">{kycRejectedMessage}</p>
          <div className="modal-actions">
            <button type="button" className="primary-button modal-primary-button" onClick={() => setKycRejectedModalOpen(false)}>
              {t("common.close")}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={step === "payment"} title={t("modal.payment.title")} onClose={() => setStep("none")}>
        <div className="modal-body modal-body--form">
          <p className="modal-description">
            {tradeSide === "buy" ? t("modal.payment.cryptoDescription") : t("modal.payment.bankDescription")}
          </p>
          {tradeSide === "buy" ? (
            <>
              <div className="modal-field">
                <label>{t("common.network")}</label>
                <select value={network} onChange={(e: { target: { value: string } }) => setNetwork(e.target.value)}>
                  {networksAndFees.map((item: OtcWithdrawNetwork) => (
                    <option key={item.network} value={item.network}>
                      {item.userFriendlyNetworkName} - Taxa: {formatNetworkFeeAmount(item.withdrawFee)} {asset}
                      {` (${formatFiatAmount(locale, brand.fiatCurrency, item.withdrawFeeBrlEstimate)})`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="modal-field">
                <label>{t("common.wallet")}</label>
                <input value={walletAddress} onChange={(e: { target: { value: string } }) => setWalletAddress(e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div className="modal-section-title">{bankLabel} - {t("payment.bankTitle")}</div>
              <div className="modal-field">
                <label>{t("common.keyType")}</label>
                <select value={bankKeyType} onChange={(e: { target: { value: string } }) => setBankKeyType(e.target.value)}>
                  <option value="Telefone">Telefone</option>
                  <option value="Email">Email</option>
                  <option value="Documento">{t("common.document")}</option>
                  <option value="Aleatoria">Aleatoria</option>
                </select>
              </div>
              <div className="modal-field">
                <label>{t("common.keyValue")}</label>
                <input value={bankKeyValue} onChange={(e: { target: { value: string } }) => setBankKeyValue(e.target.value)} />
              </div>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="primary-button modal-primary-button" onClick={handleSavePayment}>
              {tradeSide === "buy" ? t("common.saveWallet") : t("common.saveKey")}
            </button>
          </div>
        </div>
      </Modal>

      {blockingUi ? (
        <div className="flow-loading-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="flow-loading-card">
            <div className="flow-loading-spinner" />
            <strong>{blockingUi.title}</strong>
            {blockingUi.description ? <p>{blockingUi.description}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
