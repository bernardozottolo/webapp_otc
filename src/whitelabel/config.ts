import type { Country, Locale } from "../shared/types";

export type PaymentKind = "crypto" | "bank";
export type ThemeVariableName =
  | "--brand-color"
  | "--brand-accent"
  | "--text-primary"
  | "--text-secondary"
  | "--text-muted"
  | "--text-soft"
  | "--text-inverse"
  | "--text-accent-dark"
  | "--nav-text-color"
  | "--nav-text-muted-color"
  | "--promo-headline-color"
  | "--promo-text-color"
  | "--promo-muted-color"
  | "--promo-soft-color"
  | "--form-text-color"
  | "--form-secondary-text-color"
  | "--form-muted-text-color"
  | "--form-soft-text-color"
  | "--form-accent-text-color"
  | "--button-primary-text"
  | "--page-shell-background"
  | "--page-background-start"
  | "--page-background-end"
  | "--page-background-image"
  | "--page-background-image-opacity"
  | "--page-background-overlay-color"
  | "--page-background-overlay-opacity"
  | "--nav-background"
  | "--nav-border-color"
  | "--logo-background"
  | "--ghost-button-background"
  | "--ghost-button-border"
  | "--card-background"
  | "--card-shadow"
  | "--chip-background"
  | "--tab-border-color"
  | "--input-border-color"
  | "--input-background"
  | "--field-shell-background"
  | "--pill-border-color"
  | "--pill-background"
  | "--details-border-color"
  | "--details-background"
  | "--benefit-dot-color"
  | "--payment-slot-background"
  | "--modal-overlay-background"
  | "--button-close-background";

export interface ThemeConfig {
  cssVariables?: Partial<Record<ThemeVariableName, string>>;
}

export interface OrderLoadingConfig {
  spinnerColor: string;
  textColor: string;
  message: string;
}

export interface OrderPersistenceConfig {
  ttlMs: number;
  pollIntervalMs: number;
}

export interface OrderTimerColorsConfig {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
}

export interface OrderTimerConfig {
  durationSeconds: number;
  warningThresholdSeconds: number;
  normal: OrderTimerColorsConfig;
  warning: OrderTimerColorsConfig;
}

export interface OrderStatusContentConfig {
  title: string;
  message: string;
  emoji: string;
}

export interface OrderStatusLabelsConfig {
  created: string;
  processing: string;
  completed: string;
  waitingForPayment: string;
  paymentConfirmed: string;
  concluded: string;
  cancelled: string;
}

export interface OrderPageTextsConfig {
  title: string;
  loading: string;
  notFound: string;
  serverUnavailable: string;
  summaryTitle: string;
  summaryBuyTitle: string;
  summarySellTitle: string;
  paymentTitle: string;
  customerPaymentTitle: string;
  receiveTitle: string;
  payTitle: string;
  paymentInfoTooltip: string;
  paymentInfoModalTitle: string;
  timerLabel: string;
  timerExpiredLabel: string;
  statusLabel: string;
  orderIdLabel: string;
  operationLabel: string;
  assetLabel: string;
  quantityLabel: string;
  totalLabel: string;
  priceLabel: string;
  beneficiaryLabel: string;
  bankLabel: string;
  taxIdLabel: string;
  walletLabel: string;
  networkLabel: string;
  txHashLabel: string;
  txHashLinkLabel: string;
  copyTxHashLabel: string;
  copiedTxHashLabel: string;
  payloadLabel: string;
  qrCodeAltLabel: string;
  qrUnavailableMessage: string;
  copyPixButtonLabel: string;
  copiedPixButtonLabel: string;
  buyLabel: string;
  sellLabel: string;
  waitingMessage: string;
  paymentTimeout: OrderStatusContentConfig;
  paymentRecognized: OrderStatusContentConfig;
  orderConcluded: OrderStatusContentConfig;
  paymentUpdateTimeout: OrderStatusContentConfig;
  orderUpdateTimeout: OrderStatusContentConfig;
  statusLabels: OrderStatusLabelsConfig;
}

export interface OrderPageConfig {
  backgroundColor: string;
  backgroundImage: string;
  backgroundImageOpacity: string;
  backgroundOverlayColor: string;
  backgroundOverlayOpacity: string;
  cardBackgroundColor: string;
  cardBorderColor: string;
  titleColor: string;
  textColor: string;
  mutedTextColor: string;
  accentColor: string;
  successColor: string;
  warningColor: string;
  dangerColor: string;
  statusMessageTitleColor: string;
  statusMessageTextColor: string;
  orderUpdateTimeoutMinutes: number;
  timer: OrderTimerConfig;
  texts: OrderPageTextsConfig;
}

export interface NegotiationAssetFallbackConfig {
  asset: string;
  tradeTypes: Array<"BUY" | "SELL">;
  decimalPrecisionAsset: number;
  decimalPrecisionFiat: number;
  minNegotiationValueFiat: number;
}

export interface TradeAvailabilityTextsConfig {
  buyUnavailable: string;
  sellUnavailable: string;
}

export interface FooterContactsConfig {
  phone: string;
  whatsapp: string;
  email: string;
  linkedin: string;
  facebook: string;
  instagram: string;
}

export interface FooterColorsConfig {
  backgroundColor: string;
  borderColor: string;
  titleColor: string;
  descriptionColor: string;
  contactColor: string;
  iconBackgroundColor: string;
}

export interface FooterConfig {
  title: string;
  description: string;
  contacts: FooterContactsConfig;
  colors: FooterColorsConfig;
}

export interface BrandConfig {
  id: string;
  companyName: string;
  logoUrl?: string;
  headline: string;
  subheadline: string;
  secondarySubheadline?: string;
  fiatCurrency: string;
  /**
   * Teto em moeda fiat (antes do login) para bloqueio e clamp do valor a pagar; após identificação,
   * combina com o limite remanescente da API via `Math.min(cap, remaining)`.
   */
  transactionalCapFiat: number;
  primaryColor: string;
  supportEmail: string;
  legalDisclaimer: string;
  defaultLocale: Locale;
  defaultCountry: Country;
  enabledCountries: Country[];
  enabledPaymentKinds: PaymentKind[];
  bankLabelByCountry: Record<Country, string>;
  documentTypesByCountry: Record<Country, string[]>;
  companyDocumentTypes: Record<Country, string[]>;
  occupations: string[];
  occupationsAvailable: string[];
  tradeAvailabilityTexts: TradeAvailabilityTextsConfig;
  footer: FooterConfig;
  backend: {
    companyKey: string;
    platform: string;
    /** Browser mode real usa sempre same-origin; `mock://...` continua permitido. */
    clientsDbBaseUrl: string;
    /** Days before an OTC counterparty KYC must be revalidated on login. `0` disables expiry. */
    otcKycValidityDays: number;
    localPaymentAssetByCountry: Record<Country, string>;
    negotiationAssetsFallback: NegotiationAssetFallbackConfig[];
    didit: {
      /** Browser mode real usa sempre same-origin; `mock://didit` continua permitido. */
      apiBaseUrl: string;
      /**
       * How long an approved document verification remains valid for the biometric-validation path.
       * Set to `0` to disable the age check (any approved verification counts).
       * Example: `365` = must be completed within the last year (when timestamps are present).
       */
      documentVerificationValidityDays: number;
      sdkMode: "modal";
    };
  };
  endpoints: {
    quoteBaseUrl: string;
    /**
     * Mantido por compatibilidade; chamadas OTC reais do browser sao sempre same-origin.
     * `mock://quote` continua permitido para cenarios mock.
     */
    otcViaSameOrigin: boolean;
    customerBaseUrl: string;
    paymentBaseUrl: string;
    orderBaseUrl: string;
    sendEmailUrl: string;
    updateWebhookBaseUrl: string;
  };
  orderLoading: OrderLoadingConfig;
  orderPersistence: OrderPersistenceConfig;
  orderPage: OrderPageConfig;
  theme?: ThemeConfig;
}

const COUNTRIES: Country[] = ["BR"];
const LOCALES: Locale[] = ["pt-BR"];
const PAYMENT_KINDS: PaymentKind[] = ["crypto", "bank"];
const DEFAULT_NEGOTIATION_ASSET_DECIMAL_PRECISION = 6;
const DEFAULT_NEGOTIATION_FIAT_DECIMAL_PRECISION = 2;

export const supportedThemeVariables: ThemeVariableName[] = [
  "--brand-color",
  "--brand-accent",
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--text-soft",
  "--text-inverse",
  "--text-accent-dark",
  "--nav-text-color",
  "--nav-text-muted-color",
  "--promo-headline-color",
  "--promo-text-color",
  "--promo-muted-color",
  "--promo-soft-color",
  "--form-text-color",
  "--form-secondary-text-color",
  "--form-muted-text-color",
  "--form-soft-text-color",
  "--form-accent-text-color",
  "--button-primary-text",
  "--page-shell-background",
  "--page-background-start",
  "--page-background-end",
  "--page-background-image",
  "--page-background-image-opacity",
  "--page-background-overlay-color",
  "--page-background-overlay-opacity",
  "--nav-background",
  "--nav-border-color",
  "--logo-background",
  "--ghost-button-background",
  "--ghost-button-border",
  "--card-background",
  "--card-shadow",
  "--chip-background",
  "--tab-border-color",
  "--input-border-color",
  "--input-background",
  "--field-shell-background",
  "--pill-border-color",
  "--pill-background",
  "--details-border-color",
  "--details-background",
  "--benefit-dot-color",
  "--payment-slot-background",
  "--modal-overlay-background",
  "--button-close-background"
];

export const defaultBankLabelByCountry: Record<Country, string> = {
  BR: "PIX"
};

export const defaultDocumentTypesByCountry: Record<Country, string[]> = {
  BR: ["CPF", "CNPJ"]
};

export const defaultCompanyDocumentTypes: Record<Country, string[]> = {
  BR: ["CNPJ"]
};

export const defaultFooterConfig: FooterConfig = {
  title: "Fale Conosco",
  description: "Entre em contato com nossa equipe para mais informações ou para saber como aumentar seu limite transacional.",
  contacts: {
    phone: "",
    whatsapp: "",
    email: "",
    linkedin: "",
    facebook: "",
    instagram: ""
  },
  colors: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(255, 255, 255, 0.16)",
    titleColor: "#ffffff",
    descriptionColor: "#dddddd",
    contactColor: "#ffffff",
    iconBackgroundColor: "rgba(255, 255, 255, 0.12)"
  }
};

export const defaultBrandConfig: BrandConfig = {
  id: "default",
  companyName: "Infinite Ativos Virtuais",
  headline: "Inovação e Segurança em Cada Transação",
  subheadline: "Cotação em tempo real, validação de identidade e liquidação segura.",
  fiatCurrency: "BRL",
  transactionalCapFiat: 5000,
  primaryColor: "#f5c242",
  supportEmail: "support@infiniteativosvirtuais.com.br",
  legalDisclaimer: "Serviço sujeito a compliance e políticas locais.",
  defaultLocale: "pt-BR",
  defaultCountry: "BR",
  enabledCountries: ["BR"],
  enabledPaymentKinds: ["crypto", "bank"],
  bankLabelByCountry: defaultBankLabelByCountry,
  documentTypesByCountry: defaultDocumentTypesByCountry,
  companyDocumentTypes: defaultCompanyDocumentTypes,
  occupations: ["Representante Legal", "Sócio", "Funcionário"],
  occupationsAvailable: ["Representante Legal", "Sócio"],
  tradeAvailabilityTexts: {
    buyUnavailable: "Compra não está disponível no momento.",
    sellUnavailable: "Venda não está disponível no momento."
  },
  footer: defaultFooterConfig,
  backend: {
    companyKey: "origin",
    platform: "webapp",
    clientsDbBaseUrl: "",
    otcKycValidityDays: 30,
    localPaymentAssetByCountry: {
      BR: "PIX"
    },
    negotiationAssetsFallback: [
      { asset: "USDT", tradeTypes: ["BUY", "SELL"], decimalPrecisionAsset: 3, decimalPrecisionFiat: 2, minNegotiationValueFiat: 100 },
      { asset: "BTC", tradeTypes: ["BUY"], decimalPrecisionAsset: 6, decimalPrecisionFiat: 2, minNegotiationValueFiat: 100 },
      { asset: "ETH", tradeTypes: ["BUY", "SELL"], decimalPrecisionAsset: 5, decimalPrecisionFiat: 2, minNegotiationValueFiat: 100 }
    ],
    didit: {
      apiBaseUrl: "",
      documentVerificationValidityDays: 365,
      sdkMode: "modal"
    }
  },
  endpoints: {
    quoteBaseUrl: "mock://quote",
    otcViaSameOrigin: false,
    customerBaseUrl: "mock://customer",
    paymentBaseUrl: "mock://payment",
    orderBaseUrl: "mock://order",
    sendEmailUrl: "",
    updateWebhookBaseUrl: ""
  },
  orderLoading: {
    spinnerColor: "#f5c242",
    textColor: "#111827",
    message: ""
  },
  orderPersistence: {
    ttlMs: 60 * 60 * 1000,
    pollIntervalMs: 5_000
  },
  orderPage: {
    backgroundColor: "#f6f7fb",
    backgroundImage: "none",
    backgroundImageOpacity: "1",
    backgroundOverlayColor: "#000000",
    backgroundOverlayOpacity: "0",
    cardBackgroundColor: "#ffffff",
    cardBorderColor: "#dbe3f0",
    titleColor: "#111827",
    textColor: "#111827",
    mutedTextColor: "#64748b",
    accentColor: "#1d4ed8",
    successColor: "#15803d",
    warningColor: "#2563eb",
    dangerColor: "#b91c1c",
    statusMessageTitleColor: "#ffffff",
    statusMessageTextColor: "#9ca3af",
    orderUpdateTimeoutMinutes: 5,
    timer: {
      durationSeconds: 15 * 60,
      warningThresholdSeconds: 5 * 60,
      normal: {
        backgroundColor: "#eff6ff",
        borderColor: "#93c5fd",
        textColor: "#1d4ed8"
      },
      warning: {
        backgroundColor: "#fff7ed",
        borderColor: "#fdba74",
        textColor: "#c2410c"
      }
    },
    texts: {
      title: "Status do pedido",
      loading: "Carregando pedido...",
      notFound: "Pedido não encontrado.",
      serverUnavailable: "Nossos servidores estão indisponíveis no momento. Tente novamente em instantes.",
      summaryTitle: "Resumo do pedido",
      summaryBuyTitle: "Resumo do pedido de compra",
      summarySellTitle: "Resumo do pedido de venda",
      paymentTitle: "Pagamento",
      customerPaymentTitle: "Dados de recebimento",
      receiveTitle: "Você recebe",
      payTitle: "Você paga",
      paymentInfoTooltip: "Clique para saber mais sobre os dados de pagamento.",
      paymentInfoModalTitle: "Dados de pagamento",
      timerLabel: "Tempo para pagar",
      timerExpiredLabel: "Tempo esgotado",
      statusLabel: "Status",
      orderIdLabel: "ID do pedido",
      operationLabel: "Operação",
      assetLabel: "Ativo",
      quantityLabel: "Quantidade",
      totalLabel: "Total",
      priceLabel: "Preço",
      beneficiaryLabel: "Beneficiário",
      bankLabel: "Banco",
      taxIdLabel: "CNPJ",
      walletLabel: "Wallet",
      networkLabel: "Rede",
      txHashLabel: "Transação",
      txHashLinkLabel: "Clique aqui para ver o comprovante da transação",
      copyTxHashLabel: "Copiar transação",
      copiedTxHashLabel: "Transação copiada",
      payloadLabel: "Payload PIX",
      qrCodeAltLabel: "QR Code do pagamento",
      qrUnavailableMessage: "QR Code indisponível.",
      copyPixButtonLabel: "Copiar Pix Cópia e Cola",
      copiedPixButtonLabel: "PIX copiado",
      buyLabel: "Compra",
      sellLabel: "Venda",
      waitingMessage: "Assim que o pagamento for identificado, atualizaremos esta tela automaticamente.",
      paymentTimeout: {
        title: "Pagamento expirado",
        message: "O prazo de pagamento terminou. Gere um novo pedido para continuar.",
        emoji: "⏰"
      },
      paymentRecognized: {
        title: "Pagamento reconhecido",
        message: "Pagamento reconhecido, pegue um café e aguarde que já enviamos as cripto. Pode levar até 5 minutos.",
        emoji: "☕"
      },
      orderConcluded: {
        title: "Pedido concluído",
        message: "Tudo certo. As criptos foram enviadas para a carteira informada.",
        emoji: "✅"
      },
      paymentUpdateTimeout: {
        title: "Pagamento expirado",
        message: "Que pena! Não conseguimos processar o pagamento. Se você acha que isso é um erro, entre em contato com o suporte.",
        emoji: "💔"
      },
      orderUpdateTimeout: {
        title: "Pedido atrasado",
        message: "Recebemos seu pagamento, mas ainda não tivemos novas atualizações do pedido. Se necessário, entre em contato com o suporte.",
        emoji: "💔"
      },
      statusLabels: {
        created: "Criado",
        processing: "Processando",
        completed: "Concluído",
        waitingForPayment: "Aguardando pagamento",
        paymentConfirmed: "Pagamento identificado",
        concluded: "Pedido concluído",
        cancelled: "Cancelado"
      }
    }
  },
  theme: {
    cssVariables: {
      "--brand-color": "#f5c242"
    }
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** Allows `""` for same-origin `/otc/get_pricing`. */
function asQuoteBaseUrl(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback;
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

/** Browser nunca chama OTC real cross-origin; apenas `mock://quote` ou same-origin. */
export function effectiveOtcQuoteBaseUrl(endpoints: BrandConfig["endpoints"]): string {
  const q = endpoints.quoteBaseUrl;
  if (q.startsWith("mock://")) return q;
  return "";
}

/** Browser nunca chama clients_database real cross-origin; apenas mock ou same-origin. */
export function effectiveClientsDatabaseBaseUrl(baseUrl: string): string {
  return baseUrl.startsWith("mock://") ? baseUrl : "";
}

/** Browser nunca chama Didit REST real cross-origin; apenas mock ou same-origin. */
export function effectiveDiditProxyBaseUrl(baseUrl: string): string {
  return baseUrl.startsWith("mock://") ? baseUrl : "";
}

export function effectiveOrderBaseUrl(baseUrl: string): string {
  return baseUrl.startsWith("mock://") ? baseUrl : "";
}

function asOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asPossiblyEmptyString(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback;
}

function asCountry(value: unknown, fallback: Country): Country {
  return typeof value === "string" && COUNTRIES.includes(value as Country) ? (value as Country) : fallback;
}

function asLocale(value: unknown, fallback: Locale): Locale {
  return typeof value === "string" && LOCALES.includes(value as Locale) ? (value as Locale) : fallback;
}

function asCountryArray(value: unknown, fallback: Country[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value.filter((item): item is Country => typeof item === "string" && COUNTRIES.includes(item as Country));
  return normalized.length > 0 ? normalized : fallback;
}

function asPaymentKinds(value: unknown, fallback: PaymentKind[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value.filter(
    (item): item is PaymentKind => typeof item === "string" && PAYMENT_KINDS.includes(item as PaymentKind)
  );
  return normalized.length > 0 ? normalized : fallback;
}

function asCountryStringMap(value: unknown, fallback: Record<Country, string>) {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    BR: asString(value.BR, fallback.BR)
  };
}

function asStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value.flatMap((item) => {
    if (typeof item !== "string") {
      return [];
    }
    const trimmed = item.trim();
    return trimmed ? [trimmed] : [];
  });

  return normalized.length > 0 ? normalized : fallback;
}

function asCountryStringArrayMap(value: unknown, fallback: Record<Country, string[]>) {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    BR: asStringArray(value.BR, fallback.BR)
  };
}

function asOccupationsAvailable(value: unknown, fallback: string[], occupations: string[]) {
  const normalized = asStringArray(value, fallback);
  const filtered = normalized.filter((item) => occupations.includes(item));
  return filtered.length > 0 ? filtered : fallback;
}

function asNegotiationAssetFallbackConfig(
  value: unknown,
  fallback: NegotiationAssetFallbackConfig[]
): NegotiationAssetFallbackConfig[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const asset = asString(item.asset, "").toUpperCase();
    const rawTradeTypes = Array.isArray(item.tradeTypes)
      ? item.tradeTypes
      : Array.isArray(item.trade_types)
        ? item.trade_types
        : [];
    const tradeTypes: Array<"BUY" | "SELL"> = rawTradeTypes.flatMap((tradeType) => {
      const normalizedTradeType = typeof tradeType === "string" ? tradeType.trim().toUpperCase() : "";
      return normalizedTradeType === "BUY" || normalizedTradeType === "SELL" ? [normalizedTradeType] : [];
    });
    const legacyPrecision = Math.max(
      0,
      Math.trunc(asNonNegativeNumber(item.decimalPrecision ?? item.decimal_precision, DEFAULT_NEGOTIATION_ASSET_DECIMAL_PRECISION))
    );
    const decimalPrecisionAsset = Math.max(
      0,
      Math.trunc(
        asNonNegativeNumber(item.decimalPrecisionAsset ?? item.decimal_precision_asset, legacyPrecision)
      )
    );
    const decimalPrecisionFiat = Math.max(
      0,
      Math.trunc(
        asNonNegativeNumber(item.decimalPrecisionFiat ?? item.decimal_precision_fiat, DEFAULT_NEGOTIATION_FIAT_DECIMAL_PRECISION)
      )
    );
    const minNegotiationValueFiat = asNonNegativeNumber(
      item.minNegotiationValueFiat ?? item.min_negotiation_value_fiat,
      0
    );
    if (!asset || tradeTypes.length === 0) return [];
    return [{ asset, tradeTypes, decimalPrecisionAsset, decimalPrecisionFiat, minNegotiationValueFiat }];
  });

  return normalized.length > 0 ? normalized : fallback;
}

/** Non-negative number; used for TTL days (`0` = disabled). */
function asNonNegativeNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return fallback;
}

function asTransactionalCapFiat(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function asThemeConfig(value: unknown, fallback?: ThemeConfig): ThemeConfig | undefined {
  if (!isRecord(value)) {
    return fallback;
  }

  const rawCssVariables = isRecord(value.cssVariables) ? value.cssVariables : {};
  const cssVariables = supportedThemeVariables.reduce<Partial<Record<ThemeVariableName, string>>>((accumulator, variableName) => {
    const rawValue = rawCssVariables[variableName];
    if (typeof rawValue === "string" && rawValue.trim()) {
      accumulator[variableName] = rawValue.trim();
    }
    return accumulator;
  }, {});

  if (Object.keys(cssVariables).length === 0) {
    return fallback;
  }

  return { cssVariables };
}

function asOrderLoadingConfig(value: unknown, fallback: OrderLoadingConfig): OrderLoadingConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    spinnerColor: asString(value.spinnerColor, fallback.spinnerColor),
    textColor: asString(value.textColor, fallback.textColor),
    message: asString(value.message, fallback.message)
  };
}

function asOrderPersistenceConfig(value: unknown, fallback: OrderPersistenceConfig): OrderPersistenceConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  const ttlMs = asNonNegativeNumber(value.ttlMs, fallback.ttlMs);
  const pollIntervalMs = asNonNegativeNumber(value.pollIntervalMs, fallback.pollIntervalMs);
  return {
    ttlMs: ttlMs > 0 ? ttlMs : fallback.ttlMs,
    pollIntervalMs: pollIntervalMs > 0 ? pollIntervalMs : fallback.pollIntervalMs
  };
}

function asOrderStatusContentConfig(value: unknown, fallback: OrderStatusContentConfig): OrderStatusContentConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    title: asString(value.title, fallback.title),
    message: asString(value.message, fallback.message),
    emoji: asString(value.emoji, fallback.emoji)
  };
}

function asOrderStatusLabelsConfig(value: unknown, fallback: OrderStatusLabelsConfig): OrderStatusLabelsConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    created: asString(value.created, fallback.created),
    processing: asString(value.processing, fallback.processing),
    completed: asString(value.completed, fallback.completed),
    waitingForPayment: asString(value.waitingForPayment, fallback.waitingForPayment),
    paymentConfirmed: asString(value.paymentConfirmed, fallback.paymentConfirmed),
    concluded: asString(value.concluded, fallback.concluded),
    cancelled: asString(value.cancelled, fallback.cancelled)
  };
}

function asOrderPageTextsConfig(value: unknown, fallback: OrderPageTextsConfig): OrderPageTextsConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    title: asString(value.title, fallback.title),
    loading: asString(value.loading, fallback.loading),
    notFound: asString(value.notFound, fallback.notFound),
    serverUnavailable: asString(value.serverUnavailable, fallback.serverUnavailable),
    summaryTitle: asString(value.summaryTitle, fallback.summaryTitle),
    summaryBuyTitle: asString(value.summaryBuyTitle, fallback.summaryBuyTitle),
    summarySellTitle: asString(value.summarySellTitle, fallback.summarySellTitle),
    paymentTitle: asString(value.paymentTitle, fallback.paymentTitle),
    customerPaymentTitle: asString(value.customerPaymentTitle, fallback.customerPaymentTitle),
    receiveTitle: asString(value.receiveTitle, fallback.receiveTitle),
    payTitle: asString(value.payTitle, fallback.payTitle),
    paymentInfoTooltip: asString(value.paymentInfoTooltip, fallback.paymentInfoTooltip),
    paymentInfoModalTitle: asString(value.paymentInfoModalTitle, fallback.paymentInfoModalTitle),
    timerLabel: asString(value.timerLabel, fallback.timerLabel),
    timerExpiredLabel: asString(value.timerExpiredLabel, fallback.timerExpiredLabel),
    statusLabel: asString(value.statusLabel, fallback.statusLabel),
    orderIdLabel: asString(value.orderIdLabel, fallback.orderIdLabel),
    operationLabel: asString(value.operationLabel, fallback.operationLabel),
    assetLabel: asString(value.assetLabel, fallback.assetLabel),
    quantityLabel: asString(value.quantityLabel, fallback.quantityLabel),
    totalLabel: asString(value.totalLabel, fallback.totalLabel),
    priceLabel: asString(value.priceLabel, fallback.priceLabel),
    beneficiaryLabel: asString(value.beneficiaryLabel, fallback.beneficiaryLabel),
    bankLabel: asString(value.bankLabel, fallback.bankLabel),
    taxIdLabel: asString(value.taxIdLabel, fallback.taxIdLabel),
    walletLabel: asString(value.walletLabel, fallback.walletLabel),
    networkLabel: asString(value.networkLabel, fallback.networkLabel),
    txHashLabel: asString(value.txHashLabel, fallback.txHashLabel),
    txHashLinkLabel: asString(value.txHashLinkLabel, fallback.txHashLinkLabel),
    copyTxHashLabel: asString(value.copyTxHashLabel, fallback.copyTxHashLabel),
    copiedTxHashLabel: asString(value.copiedTxHashLabel, fallback.copiedTxHashLabel),
    payloadLabel: asString(value.payloadLabel, fallback.payloadLabel),
    qrCodeAltLabel: asString(value.qrCodeAltLabel, fallback.qrCodeAltLabel),
    qrUnavailableMessage: asString(value.qrUnavailableMessage, fallback.qrUnavailableMessage),
    copyPixButtonLabel: asString(value.copyPixButtonLabel, fallback.copyPixButtonLabel),
    copiedPixButtonLabel: asString(value.copiedPixButtonLabel, fallback.copiedPixButtonLabel),
    buyLabel: asString(value.buyLabel, fallback.buyLabel),
    sellLabel: asString(value.sellLabel, fallback.sellLabel),
    waitingMessage: asString(value.waitingMessage, fallback.waitingMessage),
    paymentTimeout: asOrderStatusContentConfig(value.paymentTimeout, fallback.paymentTimeout),
    paymentRecognized: asOrderStatusContentConfig(value.paymentRecognized, fallback.paymentRecognized),
    orderConcluded: asOrderStatusContentConfig(value.orderConcluded, fallback.orderConcluded),
    paymentUpdateTimeout: asOrderStatusContentConfig(value.paymentUpdateTimeout, fallback.paymentUpdateTimeout),
    orderUpdateTimeout: asOrderStatusContentConfig(value.orderUpdateTimeout, fallback.orderUpdateTimeout),
    statusLabels: asOrderStatusLabelsConfig(value.statusLabels, fallback.statusLabels)
  };
}

function asOrderTimerColorsConfig(value: unknown, fallback: OrderTimerColorsConfig): OrderTimerColorsConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    backgroundColor: asString(value.backgroundColor, fallback.backgroundColor),
    borderColor: asString(value.borderColor, fallback.borderColor),
    textColor: asString(value.textColor, fallback.textColor)
  };
}

function asOrderTimerConfig(value: unknown, fallback: OrderTimerConfig): OrderTimerConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  const durationSeconds = asNonNegativeNumber(value.durationSeconds, fallback.durationSeconds);
  const warningThresholdSeconds = asNonNegativeNumber(value.warningThresholdSeconds, fallback.warningThresholdSeconds);
  return {
    durationSeconds: durationSeconds > 0 ? durationSeconds : fallback.durationSeconds,
    warningThresholdSeconds,
    normal: asOrderTimerColorsConfig(value.normal, fallback.normal),
    warning: asOrderTimerColorsConfig(value.warning, fallback.warning)
  };
}

function asOrderPageConfig(value: unknown, fallback: OrderPageConfig): OrderPageConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    backgroundColor: asString(value.backgroundColor, fallback.backgroundColor),
    backgroundImage: asString(value.backgroundImage, fallback.backgroundImage),
    backgroundImageOpacity: asString(value.backgroundImageOpacity, fallback.backgroundImageOpacity),
    backgroundOverlayColor: asString(value.backgroundOverlayColor, fallback.backgroundOverlayColor),
    backgroundOverlayOpacity: asString(value.backgroundOverlayOpacity, fallback.backgroundOverlayOpacity),
    cardBackgroundColor: asString(value.cardBackgroundColor, fallback.cardBackgroundColor),
    cardBorderColor: asString(value.cardBorderColor, fallback.cardBorderColor),
    titleColor: asString(value.titleColor, fallback.titleColor),
    textColor: asString(value.textColor, fallback.textColor),
    mutedTextColor: asString(value.mutedTextColor, fallback.mutedTextColor),
    accentColor: asString(value.accentColor, fallback.accentColor),
    successColor: asString(value.successColor, fallback.successColor),
    warningColor: asString(value.warningColor, fallback.warningColor),
    dangerColor: asString(value.dangerColor, fallback.dangerColor),
    statusMessageTitleColor: asString(value.statusMessageTitleColor, fallback.statusMessageTitleColor),
    statusMessageTextColor: asString(value.statusMessageTextColor, fallback.statusMessageTextColor),
    orderUpdateTimeoutMinutes: asNonNegativeNumber(value.orderUpdateTimeoutMinutes, fallback.orderUpdateTimeoutMinutes),
    timer: asOrderTimerConfig(value.timer, fallback.timer),
    texts: asOrderPageTextsConfig(value.texts, fallback.texts)
  };
}

function asTradeAvailabilityTextsConfig(value: unknown, fallback: TradeAvailabilityTextsConfig): TradeAvailabilityTextsConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    buyUnavailable: asString(value.buyUnavailable, fallback.buyUnavailable),
    sellUnavailable: asString(value.sellUnavailable, fallback.sellUnavailable)
  };
}

function asFooterContactsConfig(value: unknown, fallback: FooterContactsConfig): FooterContactsConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    phone: asPossiblyEmptyString(value.phone, fallback.phone),
    whatsapp: asPossiblyEmptyString(value.whatsapp, fallback.whatsapp),
    email: asPossiblyEmptyString(value.email, fallback.email),
    linkedin: asPossiblyEmptyString(value.linkedin, fallback.linkedin),
    facebook: asPossiblyEmptyString(value.facebook, fallback.facebook),
    instagram: asPossiblyEmptyString(value.instagram, fallback.instagram)
  };
}

function asFooterColorsConfig(value: unknown, fallback: FooterColorsConfig): FooterColorsConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    backgroundColor: asString(value.backgroundColor, fallback.backgroundColor),
    borderColor: asString(value.borderColor, fallback.borderColor),
    titleColor: asString(value.titleColor, fallback.titleColor),
    descriptionColor: asString(value.descriptionColor, fallback.descriptionColor),
    contactColor: asString(value.contactColor, fallback.contactColor),
    iconBackgroundColor: asString(value.iconBackgroundColor, fallback.iconBackgroundColor)
  };
}

function asFooterConfig(value: unknown, fallback: FooterConfig): FooterConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    title: asString(value.title, fallback.title),
    description: asString(value.description, fallback.description),
    contacts: asFooterContactsConfig(value.contacts, fallback.contacts),
    colors: asFooterColorsConfig(value.colors, fallback.colors)
  };
}

export function normalizeRuntimeBrandConfig(raw: unknown, fallback: BrandConfig = defaultBrandConfig): BrandConfig {
  if (!isRecord(raw)) {
    return fallback;
  }

  const backend = isRecord(raw.backend) ? raw.backend : {};
  const didit = isRecord(backend.didit) ? backend.didit : {};
  const endpoints = isRecord(raw.endpoints) ? raw.endpoints : {};
  const occupations = asStringArray(
    raw.occupations ?? (raw as { ocupations?: unknown }).ocupations,
    fallback.occupations
  );

  return {
    id: asString(raw.id, fallback.id),
    companyName: asString(raw.companyName, fallback.companyName),
    logoUrl: asOptionalString(raw.logoUrl),
    headline: asString(raw.headline, fallback.headline),
    subheadline: asString(raw.subheadline, fallback.subheadline),
    secondarySubheadline: asOptionalString(raw.secondarySubheadline),
    fiatCurrency: asString(raw.fiatCurrency, fallback.fiatCurrency),
    transactionalCapFiat: asTransactionalCapFiat(raw.transactionalCapFiat, fallback.transactionalCapFiat),
    primaryColor: asString(raw.primaryColor, fallback.primaryColor),
    supportEmail: asString(raw.supportEmail, fallback.supportEmail),
    legalDisclaimer: asString(raw.legalDisclaimer, fallback.legalDisclaimer),
    defaultLocale: asLocale(raw.defaultLocale, fallback.defaultLocale),
    defaultCountry: asCountry(raw.defaultCountry, fallback.defaultCountry),
    enabledCountries: asCountryArray(raw.enabledCountries, fallback.enabledCountries),
    enabledPaymentKinds: asPaymentKinds(raw.enabledPaymentKinds, fallback.enabledPaymentKinds),
    bankLabelByCountry: asCountryStringMap(raw.bankLabelByCountry, fallback.bankLabelByCountry),
    documentTypesByCountry: asCountryStringArrayMap(raw.documentTypesByCountry, fallback.documentTypesByCountry),
    companyDocumentTypes: asCountryStringArrayMap(raw.companyDocumentTypes, fallback.companyDocumentTypes),
    occupations,
    occupationsAvailable: asOccupationsAvailable(
      raw.occupationsAvailable ?? (raw as { ocupationsAvaiables?: unknown }).ocupationsAvaiables,
      fallback.occupationsAvailable,
      occupations
    ),
    tradeAvailabilityTexts: asTradeAvailabilityTextsConfig(raw.tradeAvailabilityTexts, fallback.tradeAvailabilityTexts),
    footer: asFooterConfig(raw.footer, fallback.footer),
    backend: {
      companyKey: asString(backend.companyKey, fallback.backend.companyKey),
      platform: asString(backend.platform, fallback.backend.platform),
      clientsDbBaseUrl: asString(backend.clientsDbBaseUrl, fallback.backend.clientsDbBaseUrl),
      otcKycValidityDays: asNonNegativeNumber(backend.otcKycValidityDays, fallback.backend.otcKycValidityDays),
      localPaymentAssetByCountry: asCountryStringMap(
        backend.localPaymentAssetByCountry,
        fallback.backend.localPaymentAssetByCountry
      ),
      negotiationAssetsFallback: asNegotiationAssetFallbackConfig(
        backend.negotiationAssetsFallback,
        fallback.backend.negotiationAssetsFallback
      ),
      didit: {
        apiBaseUrl: asString(didit.apiBaseUrl, fallback.backend.didit.apiBaseUrl),
        documentVerificationValidityDays: asNonNegativeNumber(
          didit.documentVerificationValidityDays,
          fallback.backend.didit.documentVerificationValidityDays
        ),
        sdkMode: "modal"
      }
    },
    endpoints: {
      quoteBaseUrl: asQuoteBaseUrl(endpoints.quoteBaseUrl, fallback.endpoints.quoteBaseUrl),
      otcViaSameOrigin: asBoolean(endpoints.otcViaSameOrigin, fallback.endpoints.otcViaSameOrigin),
      customerBaseUrl: asString(endpoints.customerBaseUrl, fallback.endpoints.customerBaseUrl),
      paymentBaseUrl: asString(endpoints.paymentBaseUrl, fallback.endpoints.paymentBaseUrl),
      orderBaseUrl: asQuoteBaseUrl(endpoints.orderBaseUrl, fallback.endpoints.orderBaseUrl),
      sendEmailUrl: asString(endpoints.sendEmailUrl, fallback.endpoints.sendEmailUrl),
      updateWebhookBaseUrl: asQuoteBaseUrl(endpoints.updateWebhookBaseUrl, fallback.endpoints.updateWebhookBaseUrl)
    },
    orderLoading: asOrderLoadingConfig(raw.orderLoading, fallback.orderLoading),
    orderPersistence: asOrderPersistenceConfig(raw.orderPersistence, fallback.orderPersistence),
    orderPage: asOrderPageConfig(raw.orderPage, fallback.orderPage),
    theme: asThemeConfig(raw.theme, fallback.theme)
  };
}
