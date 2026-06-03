import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { otcApiClient } from "../../shared/api/client";
import { setWindowOrderPayload } from "../../shared/api/orderCache";
import type { CompanyKycOwnerInfo, KycSubmitResult, PreOrderValidationInput } from "../../shared/api/contracts";
import { I18nHtml, useI18n } from "../../shared/i18n";
import { deriveQuoteResponseFromUnitPrice } from "../../shared/api/pricing";
import {
  checkBiometryPending,
  notifyBiometryImmediateApproval,
  registerBiometryPending
} from "../../shared/api/biometryPending";
import { sendFrontendTelemetryEvent } from "../../shared/api/telemetry";
import { QuoteRefreshIndicator, QUOTE_REFRESH_INTERVAL_MS } from "./QuoteRefreshIndicator";
import {
  type DocumentValidationError,
  validateAgainstRegexPattern,
  validateDocumentNumberForType
} from "../../whitelabel/documentTypes";
import {
  findPixKeyTypeConfig,
  formatPixKeyDisplay,
  formatPixKeyFromStorage,
  getPixKeyTypeLabel,
  normalizePixKeyForStorage,
  resolvePixKeyBackType,
  validatePixKeyValue
} from "../../whitelabel/pixKeyTypes";
import { bankKeyTypeToNetwork } from "../../shared/api/clientsDatabase";
import type {
  Country,
  Customer,
  Limits,
  Locale,
  NegotiationAssetInfo,
  OtcWalletRiskCheck,
  OtcWithdrawNetwork,
  OtcTransactionalAllowance,
  PaymentData,
  QuoteRequest,
  DiditBiometricResult,
  QuoteResponse,
  TradeSide
} from "../../shared/types";
import { Modal } from "../../shared/ui/Modal";
import type { BrandConfig } from "../../whitelabel/config";
import { effectiveOtcQuoteBaseUrl } from "../../whitelabel/config";
import { createOrderLoadingDocument, createOrderStatusMessageDocument } from "../../whitelabel/orderLoadingDocument";
import { startBiometricSession } from "../customer/diditAdapter";
import { getExpectedDetails } from "../../shared/api/diditProxy";
import {
  formatDisplayFiatAmount,
  formatDisplayNumber,
  DISPLAY_MIN_FRACTION_DIGITS
} from "../../shared/displayAmount";

type Step = "none" | "email" | "otp" | "kyc" | "bio" | "payment";
type BiometryReason = "onboarding" | "payment";
type BiometryPreConfirmVariant = "onboarding" | "payment";
type CounterpartyKycMode = "onboarding" | "refresh";
type EmailAuthIntent = "login" | "onboarding" | "kyc_refresh";
type PendingKycApproval = Pick<KycSubmitResult, "approvedKycResult" | "kycDate" | "personType" | "kycName" | "birthDate"> & {
  documentNumber: string;
};

type PendingPaymentSave = {
  payload: PaymentData;
  riskCheck?: OtcWalletRiskCheck;
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

function buildWalletInfoForEmail(payment: PaymentData): { asset: string; wallet: string; network: string } | undefined {
  const asset = payment.asset?.trim().toUpperCase();
  if (!asset) {
    return undefined;
  }
  if (payment.kind === "crypto") {
    const wallet = payment.walletAddress?.trim();
    if (!wallet) {
      return undefined;
    }
    return {
      asset,
      wallet,
      network: payment.network?.trim() ?? ""
    };
  }
  const wallet = payment.bankKeyValue?.trim();
  if (!wallet) {
    return undefined;
  }
  return {
    asset,
    wallet,
    network: bankKeyTypeToNetwork(payment.bankKeyType)
  };
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

function resolveEmailAuthIntent(
  lookup: { exists: boolean; customer: Customer | null },
  otcKycValidityDays: number
): EmailAuthIntent {
  const { customer, exists } = lookup;
  if (!customer) {
    return "onboarding";
  }
  if (exists && !hasExpiredCounterpartyKyc(customer, otcKycValidityDays)) {
    return "login";
  }
  if (hasApprovedCounterpartyKyc(customer.approvedKycResult) && hasExpiredCounterpartyKyc(customer, otcKycValidityDays)) {
    return "kyc_refresh";
  }
  return "onboarding";
}

function formatFiatAmount(locale: Locale, currencyCode: string, amount: number) {
  return formatDisplayFiatAmount(locale, currencyCode, amount);
}

function formatFiatAmountWithPrecision(locale: Locale, currencyCode: string, amount: number, fractionDigits: number) {
  return formatDisplayFiatAmount(locale, currencyCode, amount, fractionDigits);
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

function formatAssetQuoteAmount(locale: Locale, amount: number, decimalPrecision: number) {
  return formatDisplayNumber(locale, amount, decimalPrecision);
}

function formatNetworkFeeAmount(locale: Locale, amount: number) {
  return formatDisplayNumber(locale, amount, 8);
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
  const [emailConsentAccepted, setEmailConsentAccepted] = useState(false);
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
  const [pendingPaymentSave, setPendingPaymentSave] = useState<PendingPaymentSave | null>(null);
  const pendingPaymentSaveRef = useRef<PendingPaymentSave | null>(null);
  const pendingEmailAuthRef = useRef<{ intent: EmailAuthIntent; customer: Customer | null } | null>(null);
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
  const [documentValidationMessage, setDocumentValidationMessage] = useState<string | null>(null);
  const [biometricIdentityOverride, setBiometricIdentityOverride] = useState<BiometricIdentityOverride | null>(null);
  const [kycRejectedModalOpen, setKycRejectedModalOpen] = useState(false);
  const [biometryReviewModalOpen, setBiometryReviewModalOpen] = useState(false);
  const [biometryReviewModalMessage, setBiometryReviewModalMessage] = useState("");
  const [biometryPreConfirmOpen, setBiometryPreConfirmOpen] = useState(false);
  const [biometryPreConfirmVariant, setBiometryPreConfirmVariant] = useState<BiometryPreConfirmVariant | null>(null);

  const [network, setNetwork] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [walletValidationMessage, setWalletValidationMessage] = useState<string | null>(null);
  const [bankKeyType, setBankKeyType] = useState("phone");
  const [bankKeyValue, setBankKeyValue] = useState("");
  const [bankKeyValidationError, setBankKeyValidationError] = useState<string | null>(null);
  const [networksAndFees, setNetworksAndFees] = useState<OtcWithdrawNetwork[]>([]);
  const [networksAndFeesLoading, setNetworksAndFeesLoading] = useState(false);
  const [depositNetworks, setDepositNetworks] = useState<OtcWithdrawNetwork[]>([]);
  const [depositNetwork, setDepositNetwork] = useState("");
  const [depositNetworksLoading, setDepositNetworksLoading] = useState(false);
  const [depositNetworksLoadError, setDepositNetworksLoadError] = useState(false);
  const [bankKeyOwnerError, setBankKeyOwnerError] = useState<string | null>(null);
  const [blockingUi, setBlockingUi] = useState<BlockingUiState | null>(null);
  const bioAutostartedRef = useRef(false);

  useEffect(() => {
    pendingPaymentSaveRef.current = pendingPaymentSave;
  }, [pendingPaymentSave]);

  const bankLabel = useMemo(() => brand.bankLabelByCountry[country] ?? brand.bankLabelByCountry[brand.defaultCountry], [brand, country]);
  const companyDocumentTypes = useMemo(
    () => brand.companyDocumentTypes[country] ?? brand.companyDocumentTypes[brand.defaultCountry] ?? [],
    [brand, country]
  );
  const documentTypeConfigs = useMemo(
    () => brand.documentTypesByCountry[country] ?? brand.documentTypesByCountry[brand.defaultCountry] ?? [],
    [brand, country]
  );
  const pixKeyTypeConfigs = useMemo(
    () => brand.pixKeyTypesByCountry[country] ?? brand.pixKeyTypesByCountry[brand.defaultCountry] ?? [],
    [brand, country]
  );
  const pixKeyDefaults = useMemo(
    () => brand.pixKeyDefaultsByCountry[country] ?? brand.pixKeyDefaultsByCountry[brand.defaultCountry],
    [brand, country]
  );
  const selectedPixKeyTypeConfig = useMemo(
    () => findPixKeyTypeConfig(pixKeyTypeConfigs, bankKeyType),
    [pixKeyTypeConfigs, bankKeyType]
  );
  const otcQuoteBaseUrl = useMemo(() => effectiveOtcQuoteBaseUrl(brand.endpoints), [brand.endpoints]);
  const formatDocumentValidationError = useCallback(
    (error: DocumentValidationError, docType: string) => {
      if (error === "required") {
        return t("kyc.documentRequired");
      }
      return t("kyc.documentInvalid").replace("{type}", docType);
    },
    [t]
  );
  const biometryPendingUserMessage = useMemo(
    () => brand.biometryReview.pendingUserMessage.trim() || t("biometry.pendingReview"),
    [brand.biometryReview.pendingUserMessage, t]
  );
  const openBiometryReviewModal = useCallback((message: string) => {
    setBiometryReviewModalMessage(message);
    setBiometryReviewModalOpen(true);
  }, []);
  const biometryPreConfirmContent = useMemo(() => {
    const config = brand.biometryPreConfirm;
    if (biometryPreConfirmVariant === "payment") {
      return { title: config.paymentTitle, description: config.paymentDescription };
    }
    if (biometryPreConfirmVariant === "onboarding") {
      return { title: config.onboardingTitle, description: config.onboardingDescription };
    }
    return { title: "", description: "" };
  }, [biometryPreConfirmVariant, brand.biometryPreConfirm]);
  const openBiometryPreConfirm = useCallback((variant: BiometryPreConfirmVariant) => {
    setStep("none");
    setBiometryPreConfirmVariant(variant);
    setBiometryPreConfirmOpen(true);
  }, []);
  const cancelBiometryPreConfirm = useCallback(() => {
    setBiometryPreConfirmOpen(false);
    setBiometryPreConfirmVariant(null);
  }, []);
  const proceedBiometryPreConfirm = useCallback(() => {
    setBiometryPreConfirmOpen(false);
    setBiometryPreConfirmVariant(null);
    setStep("bio");
  }, []);
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
          brand.footer.legalInfoLeft.trim() ||
          brand.footer.legalInfoRight.trim() ||
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
  const footerLegalInfoStyle = useMemo(
    () => ({ color: brand.footer.colors.descriptionColor }),
    [brand.footer.colors.descriptionColor]
  );
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

  const sellDepositNetworkMissing = tradeSide === "sell" && !depositNetwork.trim();

  const anonymousFlowBlocked =
    !identified &&
    (!parsedAmount ||
      belowMinimumNegotiationValue ||
      exceedsLimit ||
      sellDepositNetworkMissing ||
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

  const resetOtpFields = useCallback(() => {
    setOtpCode("");
    setOtpPreview("");
  }, []);

  const resetOtpState = useCallback(() => {
    resetOtpFields();
    pendingEmailAuthRef.current = null;
  }, [resetOtpFields]);

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

  const handleBiometryInReview = useCallback(
    async (biometric: DiditBiometricResult, targetEmail: string) => {
      const showBiometryReviewMessage = (message: string) => {
        setStep("none");
        openBiometryReviewModal(message);
      };
      if (!biometric.sessionId) {
        showBiometryReviewMessage(biometryPendingUserMessage);
        return;
      }
      const action = biometryReason === "onboarding" ? "onboarding" : "wallet_save";
      let actionPayload: Record<string, unknown> = {};
      if (action === "onboarding") {
        if (!pendingKyc) {
          showBiometryReviewMessage(biometryPendingUserMessage);
          return;
        }
        actionPayload = {
          email: targetEmail,
          document_number: pendingKyc.documentNumber,
          person_type: pendingKyc.personType,
          kyc_name: pendingKyc.kycName,
          birth_date: pendingKyc.birthDate,
          approved_kyc_result: pendingKyc.approvedKycResult,
          kyc_date: pendingKyc.kycDate,
          biometric_identity_override: biometricIdentityOverride
        };
      } else {
        const pending = pendingPaymentSaveRef.current;
        if (!pending) {
          showBiometryReviewMessage(biometryPendingUserMessage);
          return;
        }
        actionPayload = {
          payment_data: pending.payload,
          risk_check: pending.riskCheck ?? null
        };
      }
      try {
        const result = await registerBiometryPending({
          sessionId: biometric.sessionId,
          sessionStatus: "In Review",
          action,
          email: targetEmail,
          asset: tradeSide === "buy" ? asset : undefined,
          actionPayload
        });
        showBiometryReviewMessage(result.message || biometryPendingUserMessage);
      } catch (error) {
        const message = error instanceof Error ? error.message : biometryPendingUserMessage;
        showBiometryReviewMessage(message);
        return;
      }
      paymentBiometryDocRetryConsumedRef.current = false;
      resetCompanyRepresentativeState();
      setPendingPaymentSave(null);
      pendingPaymentSaveRef.current = null;
    },
    [
      asset,
      biometryPendingUserMessage,
      biometryReason,
      biometricIdentityOverride,
      openBiometryReviewModal,
      pendingKyc,
      resetCompanyRepresentativeState,
      tradeSide
    ]
  );

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
      setDocumentValidationMessage(null);
    },
    [companyRepresentativeContext, resetCompanyRepresentativeState]
  );

  const handleDocumentNumberChange = useCallback(
    (value: string) => {
      if (companyRepresentativeContext) {
        resetCompanyRepresentativeState();
      }
      setDocumentNumber(value);
      setDocumentValidationMessage(null);
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
    const representativeDocumentError = validateDocumentNumberForType(
      documentTypeConfigs,
      selectedRepresentativeDocumentType,
      normalizedRepresentativeDocument,
      normalizeDocumentValue
    );
    if (representativeDocumentError) {
      setRepresentativeValidationMessage(
        formatDocumentValidationError(representativeDocumentError, selectedRepresentativeDocumentType)
      );
      return;
    }
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
    openBiometryPreConfirm(biometryReason === "onboarding" ? "onboarding" : "payment");
  }, [
    biometryReason,
    companyRepresentativeContext,
    openBiometryPreConfirm,
    occupationsAvailable,
    selectedOccupation,
    selectedRepresentativeDocumentNumber,
    selectedRepresentativeDocumentType,
    documentTypeConfigs,
    formatDocumentValidationError,
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
    setDocumentValidationMessage(null);
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
        setWalletValidationMessage(null);
      } else {
        const backType = resolvePixKeyBackType(paymentData?.bankKeyType ?? pixKeyDefaults.defaultBackType);
        const typeConfig = findPixKeyTypeConfig(pixKeyTypeConfigs, backType);
        setBankKeyType(typeConfig?.backType ?? pixKeyDefaults.defaultBackType);
        setBankKeyValue(
          paymentData?.bankKeyValue
            ? formatPixKeyFromStorage(typeConfig, paymentData.bankKeyValue, pixKeyDefaults)
            : ""
        );
        setBankKeyOwnerError(null);
        setBankKeyValidationError(null);
      }
      setStep("payment");
    }, t("loading.fetchingPayment"));
  };

  const handlePaymentAction = async () => {
    if (!customer) return;
    setPaymentSlotError(null);
    if (tradeSide === "buy") {
      try {
        const pendingCheck = await checkBiometryPending(
          "wallet_save",
          customer.email,
          asset,
          customer.documentNumber ?? undefined
        );
        if (pendingCheck.blocked) {
          openBiometryReviewModal(pendingCheck.message ?? brand.biometryReview.duplicateWalletMessage);
          return;
        }
      } catch {
        // Redis/API indisponível: não bloqueia abertura do modal.
      }
    }
    await openPaymentModal();
  };

  useEffect(() => {
    pricingSnapRef.current = null;
    lastPricingSuccessKeyRef.current = "";
    setQuote(null);
    void refreshQuote();
    const timer = window.setInterval(() => void refreshQuote(), QUOTE_REFRESH_INTERVAL_MS);
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
    let mounted = true;
    setDepositNetworksLoading(true);
    setDepositNetworksLoadError(false);
    const loadDepositNetworks = async () => {
      try {
        const networks = await otcApiClient.getDepositNetworks(asset);
        if (!mounted) return;
        setDepositNetworks(networks);
        setDepositNetwork((current) =>
          current && networks.some((item) => item.network === current) ? current : ""
        );
        setDepositNetworksLoadError(false);
      } catch {
        if (!mounted) return;
        setDepositNetworks([]);
        setDepositNetwork("");
        setDepositNetworksLoadError(true);
      } finally {
        if (mounted) setDepositNetworksLoading(false);
      }
    };
    void loadDepositNetworks();
    return () => {
      mounted = false;
    };
  }, [asset, otcQuoteBaseUrl]);

  useEffect(() => {
    if (step !== "bio") {
      bioAutostartedRef.current = false;
      return;
    }
    if (bioAutostartedRef.current) return;
    bioAutostartedRef.current = true;
    void handleBiometric();
  }, [step]);

  const emailConsentLabel = brand.emailConsentLabel?.trim() ?? "";
  const requiresEmailConsent = emailConsentLabel.length > 0;

  const handleEmailLookup = async () => {
    if (!email) return;
    if (requiresEmailConsent && !emailConsentAccepted) return;
    await runWithBlockingUi(async () => {
      const lookup = await otcApiClient.lookupCustomerByEmail(email);
      const intent = resolveEmailAuthIntent(lookup, brand.backend.otcKycValidityDays);

      if (intent === "onboarding") {
        setPendingKyc(null);
        try {
          const pendingCheck = await checkBiometryPending("onboarding", email);
          if (pendingCheck.blocked) {
            openBiometryReviewModal(pendingCheck.message ?? brand.biometryReview.duplicateOnboardingMessage);
            return;
          }
        } catch {
          // Redis/API indisponível: não bloqueia cadastro.
        }
      }

      const send = await otcApiClient.sendOtp(email, Date.now(), lookup.exists);
      emitFrontendTelemetry(intent === "login" ? "frontend_email_login_otp_sent" : "frontend_email_unregistered", {
        lookup_response: lookup,
        send_otp_response: send,
        auth_intent: intent
      });
      resetOtpFields();
      pendingEmailAuthRef.current = { intent, customer: lookup.customer };
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
      const pending = pendingEmailAuthRef.current;
      if (!pending) {
        resetOtpState();
        return;
      }

      if (pending.intent === "login") {
        const profile = await loadIdentityContext(pending.customer?.email ?? email, "existing_lookup");
        if (!hasApprovedCounterpartyKyc(profile.customer.approvedKycResult)) {
          setIdentified(false);
          setStep("none");
          resetOtpState();
          alert(t("kyc.internalBlocked"));
          return;
        }
        if (hasExpiredCounterpartyKyc(profile.customer, brand.backend.otcKycValidityDays)) {
          setIdentified(false);
          await prepareCounterpartyKycStep("refresh", profile.customer.email, profile.customer);
          resetOtpState();
          alert(t("kyc.refreshRequired"));
          return;
        }
        resetOtpState();
        return;
      }

      if (pending.intent === "kyc_refresh") {
        setIdentified(false);
        await prepareCounterpartyKycStep("refresh", pending.customer?.email ?? email, pending.customer ?? undefined);
        resetOtpState();
        alert(t("kyc.refreshRequired"));
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
      const documentError = validateDocumentNumberForType(
        documentTypeConfigs,
        normalizedPersonType,
        normalizedDocument,
        normalizeDocumentValue
      );
      if (documentError) {
        setDocumentValidationMessage(formatDocumentValidationError(documentError, normalizedPersonType));
        return;
      }
      setDocumentValidationMessage(null);
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
      openBiometryPreConfirm("onboarding");
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
      let kycName =
        biometricIdentityOverride?.kycName ?? pendingKyc?.kycName ?? customer?.kycName ?? customer?.fullName ?? null;
      let birthDate = biometricIdentityOverride?.birthDate ?? pendingKyc?.birthDate ?? customer?.birthDate ?? null;
      const pendingAction = biometryReason === "onboarding" ? "onboarding" : "wallet_save";
      try {
        const pendingCheck = await checkBiometryPending(
          pendingAction,
          targetEmail,
          biometryReason === "payment" ? asset : undefined,
          targetDocument
        );
        if (pendingCheck.blocked) {
          setBlockingUi(null);
          openBiometryReviewModal(
            pendingCheck.message ??
              (pendingAction === "onboarding"
                ? brand.biometryReview.duplicateOnboardingMessage
                : brand.biometryReview.duplicateWalletMessage)
          );
          return;
        }
      } catch {
        // Redis/Didit indisponível: segue para abrir sessão.
      }

      if (!getExpectedDetails(kycName, birthDate) && customer?.documentNumber) {
        const documentTypeValue = (customer.personType ?? customer.documentType ?? documentType).trim();
        if (documentTypeValue) {
          try {
            const kyc = await otcApiClient.submitKyc({
              email: targetEmail,
              documentType: documentTypeValue,
              documentNumber: targetDocument,
              locale,
              country
            });
            if (kyc.kycName) {
              kycName = kyc.kycName;
            }
            if (kyc.birthDate) {
              birthDate = kyc.birthDate;
            }
          } catch {
            // Sem birthDate do KYC: createDiditSession falhará com mensagem clara no adapter.
          }
        }
      }
      const biometric = await startBiometricSession({
        email: targetEmail,
        documentNumber: targetDocument,
        locale,
        reason: biometryReason,
        asset: biometryReason === "payment" ? asset : undefined,
        kycName,
        birthDate,
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
          setBlockingUi(null);
          return;
        }
        if (
          biometric.errorCode === "portrait_missing" ||
          biometric.errorCode === "document_verification_missing"
        ) {
          paymentBiometryDocRetryConsumedRef.current = false;
          setBlockingUi(null);
          setStep("none");
          alert(t("biometry.documentVerificationMissing"));
          return;
        }
        if (biometric.sessionStatus === "In Review") {
          await handleBiometryInReview(biometric, targetEmail);
          return;
        }
        if (biometric.sessionStatus === "Pending") {
          if (biometryReason === "payment") {
            paymentBiometryDocRetryConsumedRef.current = false;
          }
          setStep("none");
          openBiometryReviewModal(biometryPendingUserMessage);
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
        try {
          await notifyBiometryImmediateApproval({
            action: "onboarding",
            email: targetEmail,
            sessionId: biometric.sessionId
          });
        } catch {
          // Falha no e-mail não bloqueia conclusão do cadastro.
        }
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
      let walletInfoForEmail: ReturnType<typeof buildWalletInfoForEmail>;
      if (pendingPaymentSaveRef.current) {
        const pending = pendingPaymentSaveRef.current;
        walletInfoForEmail = buildWalletInfoForEmail(pending.payload);
        await otcApiClient.savePaymentData(pending.payload);
        if (pending.payload.kind === "crypto") {
          emitFrontendTelemetry("frontend_wallet_saved", {
            payment_kind: "crypto",
            is_update: Boolean(paymentData),
            risk_check: pending.riskCheck,
            saved_payment_data: pending.payload
          });
        } else {
          emitFrontendTelemetry("frontend_wallet_saved", {
            payment_kind: "bank",
            is_update: Boolean(paymentData),
            saved_payment_data: pending.payload
          });
        }
        setPaymentData(pending.payload);
        setPaymentSlotError(null);
        setPendingPaymentSave(null);
        pendingPaymentSaveRef.current = null;
        setStep("none");
      }
      try {
        await notifyBiometryImmediateApproval({
          action: "wallet_save",
          email: targetEmail,
          asset: tradeSide === "buy" ? asset : undefined,
          sessionId: biometric.sessionId,
          walletInfo: walletInfoForEmail
        });
      } catch {
        // Falha no e-mail não bloqueia cadastro da wallet.
      }
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
        const trimmedWallet = walletAddress.trim();
        const trimmedNetwork = network.trim();
        if (!trimmedWallet || !trimmedNetwork) {
          return;
        }
        const withdrawNetwork = findWithdrawNetworkByCode(networksAndFees, trimmedNetwork);
        if (withdrawNetwork?.addressRegex && !validateAgainstRegexPattern(trimmedWallet, withdrawNetwork.addressRegex)) {
          setWalletValidationMessage(t("payment.walletInvalid").replace("{network}", withdrawNetwork.network));
          return;
        }
        setWalletValidationMessage(null);
        const check = await otcApiClient.walletKytCheck(trimmedWallet, trimmedNetwork);
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
          network: trimmedNetwork,
          walletAddress: trimmedWallet
        };
        if (!sessionBiometryDone) {
          try {
            const pendingCheck = await checkBiometryPending(
              "wallet_save",
              customer.email,
              asset,
              customerDocument
            );
            if (pendingCheck.blocked) {
              openBiometryReviewModal(pendingCheck.message ?? brand.biometryReview.duplicateWalletMessage);
              return;
            }
          } catch {
            // Redis/API indisponível: segue para biometria.
          }
          const pending = { payload, riskCheck: check };
          pendingPaymentSaveRef.current = pending;
          setPendingPaymentSave(pending);
          setStep("none");
          paymentBiometryDocRetryConsumedRef.current = false;
          if (isCompanyDocumentType(customer.personType ?? customer.documentType ?? "")) {
            await beginCompanyRepresentativePaymentFlow();
            return;
          }
          setBiometricIdentityOverride(null);
          setBiometryReason("payment");
          openBiometryPreConfirm("payment");
          return;
        }
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

      const pixValidation = validatePixKeyValue(pixKeyTypeConfigs, bankKeyType, bankKeyValue, pixKeyDefaults);
      if (pixValidation) {
        setBankKeyValidationError(brand.paymentFormTexts.pixKeyInvalid || t("payment.pixKeyInvalid"));
        return;
      }
      setBankKeyValidationError(null);
      const normalizedBankKey = normalizePixKeyForStorage(selectedPixKeyTypeConfig, bankKeyValue, pixKeyDefaults);
      const owner = await otcApiClient.bankKeyOwnerCheck(normalizedBankKey, customerDocument);
      if (!owner.approved) {
        setBankKeyOwnerError(brand.paymentFormTexts.pixKeyOwnerRejected || t("payment.ownerRejected"));
        return;
      }
      setBankKeyOwnerError(null);
      const payload: PaymentData = {
        email: customer.email,
        tradeSide,
        asset,
        country,
        kind: "bank",
        bankKeyType: resolvePixKeyBackType(bankKeyType),
        bankKeyValue: normalizedBankKey
      };
      if (!sessionBiometryDone) {
        try {
          const pendingCheck = await checkBiometryPending(
            "wallet_save",
            customer.email,
            asset,
            customerDocument
          );
          if (pendingCheck.blocked) {
            openBiometryReviewModal(pendingCheck.message ?? brand.biometryReview.duplicateWalletMessage);
            return;
          }
        } catch {
          // Redis/API indisponível: segue para biometria.
        }
        const pending = { payload };
        pendingPaymentSaveRef.current = pending;
        setPendingPaymentSave(pending);
        setStep("none");
        paymentBiometryDocRetryConsumedRef.current = false;
        if (isCompanyDocumentType(customer.personType ?? customer.documentType ?? "")) {
          await beginCompanyRepresentativePaymentFlow();
          return;
        }
        setBiometricIdentityOverride(null);
        setBiometryReason("payment");
        openBiometryPreConfirm("payment");
        return;
      }
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
    if (tradeSide === "buy" && (paymentData.kind !== "crypto" || !paymentData.walletAddress || !paymentData.network)) {
      return;
    }
    if (
      tradeSide === "sell" &&
      (paymentData.kind !== "bank" || !paymentData.bankKeyValue || !paymentData.bankKeyType || !depositNetwork)
    ) {
      return;
    }
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
      const kycInfo = {
        name: kycName,
        document,
        kycResult: mapApprovedKycToCounterpartyPayload(customer.approvedKycResult)
      };

      const runPreOrderWithPriceRefresh = async (
        preValidateBase: Omit<Parameters<typeof otcApiClient.preValidateOrder>[0], "price">
      ) => {
        let preOrder = await otcApiClient.preValidateOrder({
          ...preValidateBase,
          price: actionableQuote.unitPrice
        } as PreOrderValidationInput);
        if (!preOrder.priceIsValid) {
          const refreshedQuote = await otcApiClient.getQuote(buildQuoteRequest());
          const nextValidPrice = refreshedQuote.unitPrice;
          if (!(nextValidPrice > 0)) {
            orderTab.close();
            alert(t("order.validationFailed"));
            return null;
          }
          pricingSnapRef.current = {
            standardUnitPrice: nextValidPrice,
            finalUnitPrice: nextValidPrice,
            couponIsValid: refreshedQuote.couponIsValid ?? preOrder.couponIsValid,
            fetchedAtIso: new Date().toISOString(),
            tradeSide,
            asset,
            locale,
            country,
            pricingIdentityKey
          };
          setQuote(refreshedQuote);
          const confirmed = window.confirm(t("order.priceChangedConfirm"));
          if (!confirmed) {
            orderTab.close();
            return null;
          }
          preOrder = await otcApiClient.preValidateOrder({
            ...preValidateBase,
            price: nextValidPrice
          } as PreOrderValidationInput);
          if (!preOrder.priceIsValid) {
            orderTab.close();
            alert(t("order.validationFailed"));
            return null;
          }
        }
        return preOrder;
      };

      let order;
      let telemetryPreOrder: Awaited<ReturnType<typeof otcApiClient.preValidateOrder>> | null = null;
      let telemetryPaymentInfo: Record<string, unknown> | null = null;
      let telemetryNetworkInfo: OtcWithdrawNetwork | null = null;
      if (tradeSide === "buy") {
        if (paymentData.kind !== "crypto" || !paymentData.walletAddress || !paymentData.network) {
          orderTab.close();
          return;
        }
        const paymentInfo = {
          wallet: paymentData.walletAddress,
          network: paymentData.network
        };
        const preValidateBase = {
          asset,
          tradeType: "BUY" as const,
          coupon: appliedCoupon.trim() || undefined,
          paymentInfo,
          amount: parsedAmount,
          document,
          documentType,
          kycInfo
        };
        const preOrder = await runPreOrderWithPriceRefresh(preValidateBase);
        if (!preOrder) return;
        telemetryPreOrder = preOrder;
        telemetryPaymentInfo = paymentInfo;
        order = await otcApiClient.createOrder({
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
          kycInfo,
          kycTs,
          preOrder
        });
      } else {
        if (paymentData.kind !== "bank" || !paymentData.bankKeyValue || !paymentData.bankKeyType) {
          orderTab.close();
          return;
        }
        const networkOption = findWithdrawNetworkByCode(depositNetworks, depositNetwork);
        if (!networkOption) {
          orderTab.close();
          return;
        }
        const paymentInfo = {
          pixKey: paymentData.bankKeyValue,
          network: networkOption.network,
          pixKeyType: paymentData.bankKeyType
        };
        const preValidateBase = {
          asset,
          tradeType: "SELL" as const,
          coupon: appliedCoupon.trim() || undefined,
          paymentInfo,
          networkInfo: networkOption,
          amount: parsedAmount,
          document,
          documentType,
          kycInfo
        };
        const preOrder = await runPreOrderWithPriceRefresh(preValidateBase);
        if (!preOrder) return;
        telemetryPreOrder = preOrder;
        telemetryPaymentInfo = paymentInfo;
        telemetryNetworkInfo = networkOption;
        order = await otcApiClient.createOrder({
          email: customer.email,
          country,
          asset,
          tradeType: "SELL",
          coupon: appliedCoupon.trim() || undefined,
          paymentInfo,
          networkInfo: networkOption,
          price: preOrder.price,
          amount: parsedAmount,
          document,
          documentType,
          kycInfo,
          kycTs,
          preOrder
        });
      }
      emitFrontendTelemetry("frontend_order_created", {
        order_request: {
          version: "v2",
          email: customer.email,
          country,
          asset,
          asset_to_pay:
            tradeSide === "buy" ? brand.backend.localPaymentAssetByCountry[country] ?? brand.fiatCurrency : undefined,
          trade_type: tradeSide === "buy" ? "BUY" : "SELL",
          coupon: appliedCoupon.trim() || undefined,
          payment_info: telemetryPaymentInfo,
          network_info: telemetryNetworkInfo,
          price: telemetryPreOrder?.price,
          amount: parsedAmount,
          document,
          document_type: documentType,
          kyc_info: {
            name: kycInfo.name,
            document: kycInfo.document,
            kyc_result: kycInfo.kycResult
          },
          pre_order: telemetryPreOrder
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
    if (identified && tradeSide === "sell" && !hasPaymentReady) {
      setPaymentSlotError(
        !paymentData?.bankKeyValue || !paymentData?.bankKeyType
          ? t("form.bankKeyRequiredBeforeConfirm")
          : t("form.depositNetworkRequiredBeforeConfirm")
      );
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
        ? `${getPixKeyTypeLabel(pixKeyTypeConfigs, paymentData.bankKeyType)} - ${maskBankKey(paymentData.bankKeyValue)}`
        : null;

  const paymentMissingText = tradeSide === "buy" ? t("form.notFoundWallet") : t("form.notFoundBankKey");
  const hasPaymentReady =
    tradeSide === "buy"
      ? Boolean(paymentData?.walletAddress && paymentData.network)
      : Boolean(paymentData?.bankKeyValue && paymentData.bankKeyType && depositNetwork);
  const showPaymentSlotError = Boolean(paymentSlotError);
  const selectedNetworkOption =
    tradeSide === "buy" && paymentData?.walletAddress && paymentData.network
      ? findWithdrawNetworkByCode(networksAndFees, paymentData.network) ?? null
      : null;
  const selectedDepositNetworkOption =
    tradeSide === "sell" && depositNetwork
      ? findWithdrawNetworkByCode(depositNetworks, depositNetwork) ?? null
      : null;
  const selectedNetworkFeeBrl = selectedNetworkOption?.withdrawFeeBrlEstimate ?? null;
  const selectedDepositNetworkFeeBrl = selectedDepositNetworkOption?.withdrawFeeBrlEstimate ?? null;
  const receiveAmount =
    actionableQuote && tradeSide === "buy"
      ? Math.max(actionableQuote.outputAmount - (selectedNetworkOption?.withdrawFee ?? 0), 0)
      : actionableQuote && tradeSide === "sell"
        ? Math.max(actionableQuote.outputAmount - (selectedDepositNetworkOption?.withdrawFeeBrlEstimate ?? 0), 0)
        : actionableQuote?.outputAmount ?? null;
  const outputText =
    actionableQuote && tradeSide === "buy"
      ? formatAssetQuoteAmount(locale, receiveAmount ?? 0, assetDecimalPrecision)
      : actionableQuote && tradeSide === "sell"
        ? formatDisplayFiatAmount(locale, brand.fiatCurrency, receiveAmount ?? 0, fiatDecimalPrecision)
        : parsedAmount > 0
          ? quoteMissingLabel
          : tradeSide === "buy"
            ? formatAssetQuoteAmount(locale, 0, assetDecimalPrecision)
            : formatDisplayFiatAmount(locale, brand.fiatCurrency, 0);
  const couponInputTrimmed = couponInput.trim();
  const appliedCouponTrimmed = appliedCoupon.trim();
  const couponDirty = couponInputTrimmed !== appliedCouponTrimmed;
  const hasCouponDiscount =
    !!actionableQuote && Math.abs(actionableQuote.standardUnitPrice - actionableQuote.finalUnitPrice) > Number.EPSILON;
  const ratePriceText = (amount: number) =>
    formatDisplayNumber(locale, amount, Math.max(fiatDecimalPrecision, DISPLAY_MIN_FRACTION_DIGITS));
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
    `1 ${asset} ≈ ${ratePriceText(0)} ${brand.fiatCurrency}`
  );
  const quoteUpdatedAtTitle = actionableQuote?.updatedAt
    ? `${t("quote.updatedAt")} ${new Date(actionableQuote.updatedAt).toLocaleTimeString()}`
    : undefined;
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
    setEmailConsentAccepted(false);
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
    setEmailConsentAccepted(false);
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
    setPendingPaymentSave(null);
    pendingPaymentSaveRef.current = null;
    setPendingKyc(null);
    setDocumentType("");
    setDocumentNumber("");
    setDocumentTypes([]);
    resetCompanyRepresentativeState();
    setKycRejectedModalOpen(false);
    setBiometryReviewModalOpen(false);
    setBiometryReviewModalMessage("");
    setBiometryPreConfirmOpen(false);
    setBiometryPreConfirmVariant(null);
    setNetwork("");
    setWalletAddress("");
    setBankKeyType(pixKeyDefaults.defaultBackType);
    setBankKeyValue("");
    setBankKeyValidationError(null);
    setNetworksAndFees([]);
    setNetworksAndFeesLoading(false);
    setDepositNetwork("");
    setDepositNetworks([]);
    setDepositNetworksLoadError(false);
  }, [pixKeyDefaults.defaultBackType, resetCompanyRepresentativeState, resetOtpState]);

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

                  {tradeSide === "sell" ? (
                    <div className="row">
                      <label>{t("common.network")}</label>
                      <div className="field-shell field-shell--network-select">
                        <select
                          value={depositNetwork}
                          onChange={(e: { target: { value: string } }) => setDepositNetwork(e.target.value)}
                          disabled={depositNetworksLoading || depositNetworks.length === 0}
                          required
                        >
                          <option value="">{t("form.selectDepositNetwork")}</option>
                          {depositNetworks.map((item: OtcWithdrawNetwork) => (
                            <option key={item.network} value={item.network}>
                              {item.userFriendlyNetworkName}
                            </option>
                          ))}
                        </select>
                      </div>
                      {depositNetworksLoadError ? (
                        <p className="field-feedback field-feedback--error">{t("form.depositNetworksLoadError")}</p>
                      ) : null}
                    </div>
                  ) : null}

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
                    <div className="quote-line">
                      <span className="quote-rate-with-indicator">
                        {rateText}
                        <QuoteRefreshIndicator
                          updatedAt={displayQuote?.updatedAt}
                          loading={quoteLoading}
                          title={quoteLoading ? t("common.loading") : quoteUpdatedAtTitle}
                        />
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
                          <strong>{t("common.rate")}</strong>
                          <span className="quote-rate-with-indicator">
                            {rateText}
                            <QuoteRefreshIndicator
                              updatedAt={displayQuote?.updatedAt}
                              loading={quoteLoading}
                              title={quoteLoading ? t("common.loading") : quoteUpdatedAtTitle}
                            />
                          </span>
                        </div>
                      </div>
                      {identified && tradeSide === "buy" && hasPaymentReady ? (
                        <div className="details-row">
                          <strong>{t("common.networkFee")}</strong>
                          <span>
                            {networksAndFeesLoading
                              ? t("common.loading")
                              : selectedNetworkOption
                                ? `${formatNetworkFeeAmount(locale, selectedNetworkOption.withdrawFee)} ${asset}${
                                    selectedNetworkFeeBrl !== null && selectedNetworkFeeBrl !== undefined
                                      ? ` (${formatFiatAmountWithPrecision(locale, brand.fiatCurrency, selectedNetworkFeeBrl, fiatDecimalPrecision)})`
                                      : ""
                                  }`
                                : quoteMissingLabel}
                          </span>
                        </div>
                      ) : null}
                      {tradeSide === "sell" && depositNetwork ? (
                        <div className="details-row">
                          <strong>{t("common.networkFee")}</strong>
                          <span>
                            {depositNetworksLoading
                              ? t("common.loading")
                              : selectedDepositNetworkOption
                                ? `${formatNetworkFeeAmount(locale, selectedDepositNetworkOption.withdrawFee)} ${asset}${
                                    selectedDepositNetworkFeeBrl !== null && selectedDepositNetworkFeeBrl !== undefined
                                      ? ` (${formatFiatAmountWithPrecision(locale, brand.fiatCurrency, selectedDepositNetworkFeeBrl, fiatDecimalPrecision)})`
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
                    <>
                      <div>
                        <div className={`payment-slot${showPaymentSlotError ? " payment-slot--error" : ""}`}>
                          <div>
                            <strong>{paymentLabel}</strong>
                            <span>{paymentSummary ?? paymentMissingText}</span>
                          </div>
                          <div className="payment-slot-actions">
                            <button type="button" className="icon-button" onClick={handlePaymentAction}>
                              {paymentSummary ? t("form.edit") : t("form.add")}
                            </button>
                          </div>
                        </div>
                        {showPaymentSlotError ? (
                          <p
                            className="field-feedback field-feedback--error"
                            style={{ marginTop: "3px" }}
                          >
                            {paymentSlotError}
                          </p>
                        ) : null}
                      </div>
                    </>
                  )}
             

                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleConfirmOrder}
                    disabled={
                      identified
                        ? !actionableQuote ||
                          !parsedAmount ||
                          transactionalGateBlocksOrder ||
                          sellDepositNetworkMissing
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
            <div className="home-contact-footer__row">
              <div className="home-contact-footer__col home-contact-footer__col--left">
                {brand.footer.legalInfoLeft.trim() ? (
                  <div
                    className="home-contact-footer__legal-info"
                    style={footerLegalInfoStyle}
                    dangerouslySetInnerHTML={{ __html: brand.footer.legalInfoLeft }}
                  />
                ) : null}
              </div>

              <div className="home-contact-footer__col home-contact-footer__col--center">
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

              <div className="home-contact-footer__col home-contact-footer__col--right">
                {brand.footer.legalInfoRight.trim() ? (
                  <div
                    className="home-contact-footer__legal-info"
                    style={footerLegalInfoStyle}
                    dangerouslySetInnerHTML={{ __html: brand.footer.legalInfoRight }}
                  />
                ) : null}
              </div>
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
          {requiresEmailConsent ? (
            <label className="modal-consent">
              <input
                type="checkbox"
                className="modal-consent__checkbox"
                checked={emailConsentAccepted}
                onChange={(e) => setEmailConsentAccepted(e.target.checked)}
              />
              <span className="modal-consent__text" dangerouslySetInnerHTML={{ __html: emailConsentLabel }} />
            </label>
          ) : null}
          <div className="modal-actions">
            <button
              type="button"
              className="primary-button modal-primary-button"
              disabled={!email.trim() || (requiresEmailConsent && !emailConsentAccepted)}
              onClick={handleEmailLookup}
            >
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
          <I18nHtml messageKey="modal.otp.description" className="modal-description" />
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
          <div className={`modal-field${documentValidationMessage && !isCompanyRepresentativeStep ? " modal-field--error" : ""}`}>
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
            {documentValidationMessage && !isCompanyRepresentativeStep ? (
              <p className="modal-field-error">{documentValidationMessage}</p>
            ) : null}
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

      <Modal
        open={biometryPreConfirmOpen}
        title={biometryPreConfirmContent.title}
        onClose={cancelBiometryPreConfirm}
      >
        <div className="modal-body modal-body--form">
          <p className="modal-description modal-description--preline">{biometryPreConfirmContent.description}</p>
          <div className="modal-actions modal-actions--dual">
            <button type="button" className="modal-secondary-button" onClick={cancelBiometryPreConfirm}>
              {t("common.cancel")}
            </button>
            <button type="button" className="primary-button modal-primary-button" onClick={proceedBiometryPreConfirm}>
              {t("common.proceed")}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={biometryReviewModalOpen}
        title="Biometria em análise"
        onClose={() => setBiometryReviewModalOpen(false)}
      >
        <div className="modal-body modal-body--form">
          <p className="modal-description modal-description--preline">{biometryReviewModalMessage}</p>
          <div className="modal-actions">
            <button
              type="button"
              className="primary-button modal-primary-button"
              onClick={() => setBiometryReviewModalOpen(false)}
            >
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
                <select
                  value={network}
                  onChange={(e: { target: { value: string } }) => {
                    setNetwork(e.target.value);
                    setWalletValidationMessage(null);
                  }}
                >
                  {networksAndFees.map((item: OtcWithdrawNetwork) => (
                    <option key={item.network} value={item.network}>
                      {item.userFriendlyNetworkName} - Taxa: {formatNetworkFeeAmount(locale, item.withdrawFee)} {asset}
                      {` (${formatFiatAmount(locale, brand.fiatCurrency, item.withdrawFeeBrlEstimate)})`}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`modal-field${walletValidationMessage ? " modal-field--error" : ""}`}>
                <label>{t("common.wallet")}</label>
                <input
                  value={walletAddress}
                  onChange={(e: { target: { value: string } }) => {
                    setWalletAddress(e.target.value);
                    setWalletValidationMessage(null);
                  }}
                />
                {walletValidationMessage ? <p className="modal-field-error">{walletValidationMessage}</p> : null}
              </div>
            </>
          ) : (
            <>
              {/* <div className="modal-section-title">{bankLabel} - {t("payment.bankTitle")}</div> */}
              <div className="modal-field">
                <label>{t("common.keyType")}</label>
                <select
                  value={bankKeyType}
                  onChange={(e: { target: { value: string } }) => {
                    setBankKeyType(e.target.value);
                    setBankKeyValue("");
                    setBankKeyOwnerError(null);
                    setBankKeyValidationError(null);
                  }}
                >
                  {pixKeyTypeConfigs.map((item) => (
                    <option key={item.backType} value={item.backType}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div
                className={`modal-field${bankKeyOwnerError || bankKeyValidationError ? " modal-field--error" : ""}`}
              >
                <label>{t("common.keyValue")}</label>
                <input
                  value={bankKeyValue}
                  inputMode={selectedPixKeyTypeConfig?.inputMode}
                  onChange={(e: { target: { value: string } }) => {
                    setBankKeyValue(formatPixKeyDisplay(selectedPixKeyTypeConfig, e.target.value, pixKeyDefaults));
                    setBankKeyOwnerError(null);
                    setBankKeyValidationError(null);
                  }}
                />
                {bankKeyValidationError ? <p className="modal-field-error">{bankKeyValidationError}</p> : null}
                {bankKeyOwnerError ? <p className="modal-field-error">{bankKeyOwnerError}</p> : null}
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
