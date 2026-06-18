import { buildLegacyOrderStatusHtml } from "../shared/orderStatusHtml";
import type { Country, Locale } from "../shared/types";
import type { DocumentTypeConfig } from "./documentTypes";
import type { PixKeyCountryDefaults, PixKeyFormatPreset, PixKeyNormalizeMode, PixKeyTypeConfig } from "./pixKeyTypes";

export type { DocumentTypeConfig } from "./documentTypes";
export type { PixKeyCountryDefaults, PixKeyTypeConfig } from "./pixKeyTypes";

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
  /** Rótulo do badge de status no topo da página. */
  title: string;
  /** HTML renderizado no card de status. Placeholders: ver `OrderStatusHtmlVars` em `orderStatusHtml.ts`. */
  html: string;
}

export interface OrderStatusLabelsConfig {
  created: string;
  processing: string;
  completed: string;
  waitingForPayment: string;
  paymentConfirmed: string;
  concluded: string;
  cancelled: string;
  reproved: string;
}

export interface OrderPageSellPayNetworkWarningConfig {
  ariaLabel: string;
  bullets: string[];
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
  sellCopyWalletAddressButtonLabel: string;
  sellCopiedWalletAddressButtonLabel: string;
  sellWalletAddressLabel: string;
  /** Aviso ao lado de "via REDE" no resumo de venda (leg "você paga"). */
  sellPayNetworkWarning: OrderPageSellPayNetworkWarningConfig;
  /** Aviso abaixo do botão de copiar carteira na venda. Placeholders: {asset}, {network}. */
  sellDepositNetworkNotice: string;
  /** Aviso abaixo do bloco de pagamento na compra. Placeholders: {document}, {documentType}. */
  buyPaymentOwnershipNotice: string;
  buyLabel: string;
  sellLabel: string;
  waitingMessage: string;
  paymentSubmittedButtonLabel: string;
  undoPaymentSubmittedButtonLabel: string;
  /** Card exibido quando o cliente marca "Já realizei o pagamento" (sem confirmação do backend). */
  paymentSubmitted: OrderStatusContentConfig;
  paymentTimeout: OrderStatusContentConfig;
  /** Card exibido quando o backend reconhece o pagamento (`payment_processing` / `processing`). */
  paymentProcessing: OrderStatusContentConfig;
  orderConcluded: OrderStatusContentConfig;
  paymentUpdateTimeout: OrderStatusContentConfig;
  orderUpdateTimeout: OrderStatusContentConfig;
  paymentReproved: OrderStatusContentConfig;
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

export interface PaymentFormTextsConfig {
  pixKeyOwnerRejected: string;
  pixKeyInvalid: string;
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

export interface BiometryReviewConfig {
  pendingUserMessage: string;
  ttlHours: number;
  duplicateOnboardingMessage: string;
  duplicateWalletMessage: string;
  emailMessageTypeApprovedOnboarding: string;
  emailMessageTypeDeclinedOnboarding: string;
  emailMessageTypeExpiredOnboarding: string;
  emailMessageTypeApprovedWallet: string;
  emailMessageTypeDeclinedWallet: string;
  emailMessageTypeExpiredWallet: string;
}

export interface BiometryPreConfirmConfig {
  onboardingTitle: string;
  onboardingDescription: string;
  paymentTitle: string;
  paymentDescription: string;
}

export interface FooterConfig {
  title: string;
  description: string;
  /** HTML exibido no rodapé (esquerda), ex.: endereço e dados da empresa. */
  legalInfoLeft: string;
  /** HTML exibido no rodapé (direita), ex.: termos de uso e links legais. */
  legalInfoRight: string;
  contacts: FooterContactsConfig;
  colors: FooterColorsConfig;
}

export interface BrandConfig {
  id: string;
  companyName: string;
  logoUrl?: string;
  /** URL do favicon (`.ico`, `.png`, `.svg`, etc.). */
  faviconUrl?: string;
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
  documentTypesByCountry: Record<Country, DocumentTypeConfig[]>;
  pixKeyDefaultsByCountry: Record<Country, PixKeyCountryDefaults>;
  pixKeyTypesByCountry: Record<Country, PixKeyTypeConfig[]>;
  companyDocumentTypes: Record<Country, string[]>;
  occupations: string[];
  occupationsAvailable: string[];
  tradeAvailabilityTexts: TradeAvailabilityTextsConfig;
  paymentFormTexts: PaymentFormTextsConfig;
  biometryReview: BiometryReviewConfig;
  biometryPreConfirm: BiometryPreConfirmConfig;
  /**
   * Texto ao lado do checkbox no modal de e-mail (HTML permitido).
   * Vazio ou ausente: checkbox não é exibido.
   */
  emailConsentLabel?: string;
  footer: FooterConfig;
  backend: {
    companyKey: string;
    platform: string;
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

export const defaultDocumentTypesByCountry: Record<Country, DocumentTypeConfig[]> = {
  BR: [{ type: "CPF" }, { type: "CNPJ" }]
};

export const defaultPixKeyDefaultsByCountry: Record<Country, PixKeyCountryDefaults> = {
  BR: {
    defaultBackType: "phone",
    phoneDialCode: "55"
  }
};

export const defaultPixKeyTypesByCountry: Record<Country, PixKeyTypeConfig[]> = {
  BR: [
    {
      label: "Telefone",
      backType: "phone",
      pattern: "^\\d{10,11}$",
      normalize: "digits",
      format: "phone_br",
      inputMode: "tel"
    },
    {
      label: "E-mail",
      backType: "email",
      pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
      normalize: "lowercase_trim",
      format: "none",
      inputMode: "email"
    },
    {
      label: "Documento",
      backType: "document",
      pattern: "^(\\d{11}|\\d{14})$",
      normalize: "digits",
      format: "br_tax_id"
    },
    {
      label: "Chave aleatória",
      backType: "random_key",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
      normalize: "uuid",
      format: "uuid"
    }
  ]
};

export const defaultCompanyDocumentTypes: Record<Country, string[]> = {
  BR: ["CNPJ"]
};

export const defaultBiometryPreConfirmConfig: BiometryPreConfirmConfig = {
  onboardingTitle: "Envio de documento e verificação biométrica",
  onboardingDescription:
    "Para concluir seu cadastro, será necessário enviar um documento de identificação e realizar uma selfie em tempo real",
  paymentTitle: "Verificação biométrica",
  paymentDescription: "Precisamos validar sua identidade por reconhecimento facial"
};

export const defaultBiometryReviewConfig: BiometryReviewConfig = {
  pendingUserMessage:
    "Sua biometria está em análise. Você será notificado por e-mail em até 48 horas.",
  ttlHours: 48,
  duplicateOnboardingMessage:
    "Já existe uma biometria em análise para este e-mail. Aguarde o resultado antes de continuar.",
  duplicateWalletMessage:
    "Já existe uma biometria em análise para cadastrar carteira deste ativo. Aguarde o resultado.",
  emailMessageTypeApprovedOnboarding: "biometry_onboarding_approved",
  emailMessageTypeDeclinedOnboarding: "biometry_onboarding_declined",
  emailMessageTypeExpiredOnboarding: "biometry_onboarding_expired",
  emailMessageTypeApprovedWallet: "biometry_wallet_approved",
  emailMessageTypeDeclinedWallet: "biometry_wallet_declined",
  emailMessageTypeExpiredWallet: "biometry_wallet_expired"
};

export const defaultFooterConfig: FooterConfig = {
  title: "Fale Conosco",
  description: "Entre em contato com nossa equipe para mais informações ou para saber como aumentar seu limite transacional.",
  legalInfoLeft: "",
  legalInfoRight: "",
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
  supportEmail: "suporte@infiniteativosvirtuais.com.br",
  legalDisclaimer: "Serviço sujeito a compliance e políticas locais.",
  defaultLocale: "pt-BR",
  defaultCountry: "BR",
  enabledCountries: ["BR"],
  enabledPaymentKinds: ["crypto", "bank"],
  bankLabelByCountry: defaultBankLabelByCountry,
  documentTypesByCountry: defaultDocumentTypesByCountry,
  pixKeyDefaultsByCountry: defaultPixKeyDefaultsByCountry,
  pixKeyTypesByCountry: defaultPixKeyTypesByCountry,
  companyDocumentTypes: defaultCompanyDocumentTypes,
  occupations: ["Representante Legal", "Sócio", "Funcionário"],
  occupationsAvailable: ["Representante Legal", "Sócio"],
  tradeAvailabilityTexts: {
    buyUnavailable: "Compra não está disponível no momento.",
    sellUnavailable: "Venda não está disponível no momento."
  },
  paymentFormTexts: {
    pixKeyOwnerRejected: "Chave PIX precisa pertencer ao dono da conta",
    pixKeyInvalid: "Chave PIX inválida para o tipo selecionado."
  },
  biometryReview: defaultBiometryReviewConfig,
  biometryPreConfirm: defaultBiometryPreConfirmConfig,
  emailConsentLabel: "",
  footer: defaultFooterConfig,
  backend: {
    companyKey: "origin",
    platform: "webapp",
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
    orderBaseUrl: "mock://order"
  },
  orderLoading: {
    spinnerColor: "#f5c242",
    textColor: "#111827",
    message: ""
  },
  orderPersistence: {
    ttlMs: 7 * 24 * 60 * 60 * 1000,
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
      payloadLabel: "",
      qrCodeAltLabel: "QR Code do pagamento",
      qrUnavailableMessage: "QR Code indisponível.",
      copyPixButtonLabel: "Pix Copia e Cola",
      copiedPixButtonLabel: "PIX copiado",
      sellCopyWalletAddressButtonLabel: "Copiar Endereço da Carteira",
      sellCopiedWalletAddressButtonLabel: "Endereço copiado",
      sellWalletAddressLabel: "Endereço da carteira",
      sellPayNetworkWarning: {
        ariaLabel: "Atenção ao enviar cripto",
        bullets: [
          "O valor enviado deve ser exatamente o informado neste pedido. Valores diferentes podem não ser reconhecidos.",
          "Utilize exclusivamente a rede indicada. Enviar por outra rede pode resultar em perda permanente dos ativos."
        ]
      },
      sellDepositNetworkNotice:
        "⚠️ Envie apenas {asset} pela rede {network}. Envio por outras redes pode resultar em perda.",
      buyPaymentOwnershipNotice:
        "Utilize uma conta bancária de mesma titularidade do {documentType} {document}. Transferências realizadas por terceiros ou por contas de outra titularidade serão devolvidas.",
      buyLabel: "Compra",
      sellLabel: "Venda",
      waitingMessage: "Assim que o pagamento for identificado, atualizaremos esta tela automaticamente.",
      paymentSubmittedButtonLabel: "Já Realizei o Pagamento",
      undoPaymentSubmittedButtonLabel: "Voltar ao pagamento",
      paymentSubmitted: {
        title: "Processando pagamento",
        html: buildLegacyOrderStatusHtml(
          "⏳",
          "Recebemos a sua informação de pagamento. Estamos processando e verificando a transação — isso pode demorar alguns minutos. Esta página será atualizada automaticamente."
        )
      },
      paymentTimeout: {
        title: "Pagamento expirado",
        html: buildLegacyOrderStatusHtml(
          "⏰",
          "O prazo de pagamento terminou. Gere um novo pedido para continuar."
        )
      },
      paymentProcessing: {
        title: "Pagamento reconhecido",
        html: buildLegacyOrderStatusHtml(
          "☕",
          "Recebemos seu pagamento e já estamos processando o envio das cripto para a carteira informada.\n\nEsse processo pode levar até 5 minutos. Esta página será atualizada automaticamente."
        )
      },
      orderConcluded: {
        title: "Pedido concluído",
        html: buildLegacyOrderStatusHtml("✅", "Tudo certo. As criptos foram enviadas para a carteira informada.")
      },
      paymentUpdateTimeout: {
        title: "Pagamento expirado",
        html: buildLegacyOrderStatusHtml(
          "💔",
          "Que pena! Não conseguimos processar o pagamento. Se você acha que isso é um erro, entre em contato com o suporte."
        )
      },
      orderUpdateTimeout: {
        title: "Pedido atrasado",
        html: buildLegacyOrderStatusHtml(
          "💔",
          "Recebemos seu pagamento, mas ainda não tivemos novas atualizações do pedido. Se necessário, entre em contato com o suporte."
        )
      },
      paymentReproved: {
        title: "Pedido não processado",
        html: buildLegacyOrderStatusHtml(
          "↩️",
          "Não foi possível processar seu pedido. O reembolso do valor depositado já foi processado. Em caso de dúvida, entre em contato com {supportEmail}."
        )
      },
      statusLabels: {
        created: "Criado",
        processing: "Processando",
        completed: "Concluído",
        waitingForPayment: "Aguardando pagamento",
        paymentConfirmed: "Pagamento identificado",
        concluded: "Pedido concluído",
        cancelled: "Cancelado",
        reproved: "Pedido não processado"
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

function asDocumentTypeConfig(value: unknown): DocumentTypeConfig | null {
  if (typeof value === "string") {
    const type = value.trim();
    return type ? { type } : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const type = asString(value.type, "").trim();
  if (!type) {
    return null;
  }

  const pattern = asOptionalString(value.pattern)?.trim();
  if (!pattern) {
    return { type };
  }

  try {
    // eslint-disable-next-line no-new -- validate pattern at config load time
    new RegExp(pattern);
    return { type, pattern };
  } catch {
    return { type };
  }
}

function asDocumentTypeConfigArray(value: unknown, fallback: DocumentTypeConfig[]): DocumentTypeConfig[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value.flatMap((item) => {
    const config = asDocumentTypeConfig(item);
    return config ? [config] : [];
  });

  return normalized.length > 0 ? normalized : fallback;
}

function asDocumentTypesByCountryMap(value: unknown, fallback: Record<Country, DocumentTypeConfig[]>) {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    BR: asDocumentTypeConfigArray(value.BR, fallback.BR)
  };
}

const PIX_KEY_NORMALIZE_MODES = new Set<PixKeyNormalizeMode>(["digits", "lowercase_trim", "uuid", "none"]);
const PIX_KEY_FORMAT_PRESETS = new Set<PixKeyFormatPreset>(["phone_br", "br_tax_id", "uuid", "none"]);

function asPixKeyNormalizeMode(value: unknown, fallback: PixKeyNormalizeMode): PixKeyNormalizeMode {
  const parsed = asString(value, fallback);
  return PIX_KEY_NORMALIZE_MODES.has(parsed as PixKeyNormalizeMode) ? (parsed as PixKeyNormalizeMode) : fallback;
}

function asPixKeyFormatPreset(value: unknown, fallback: PixKeyFormatPreset): PixKeyFormatPreset {
  const parsed = asString(value, fallback);
  return PIX_KEY_FORMAT_PRESETS.has(parsed as PixKeyFormatPreset) ? (parsed as PixKeyFormatPreset) : fallback;
}

function asPixKeyInputMode(value: unknown): PixKeyTypeConfig["inputMode"] | undefined {
  const parsed = asString(value, "");
  if (parsed === "tel" || parsed === "email" || parsed === "text") {
    return parsed;
  }
  return undefined;
}

function asPixKeyTypeConfig(value: unknown): PixKeyTypeConfig | null {
  if (!isRecord(value)) {
    return null;
  }
  const label = asString(value.label, "").trim();
  const backType = asString(value.backType ?? value.back_type, "").trim();
  if (!label || !backType) {
    return null;
  }
  const pattern = asOptionalString(value.pattern)?.trim();
  if (pattern) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern);
    } catch {
      return null;
    }
  }
  const normalize = asPixKeyNormalizeMode(value.normalize, "none");
  const format = asPixKeyFormatPreset(value.format, "none");
  const inputMode = asPixKeyInputMode(value.inputMode ?? value.input_mode);
  return {
    label,
    backType,
    ...(pattern ? { pattern } : {}),
    normalize,
    format,
    ...(inputMode ? { inputMode } : {})
  };
}

function asPixKeyTypeConfigArray(value: unknown, fallback: PixKeyTypeConfig[]): PixKeyTypeConfig[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value.flatMap((item) => {
    const config = asPixKeyTypeConfig(item);
    return config ? [config] : [];
  });
  return normalized.length > 0 ? normalized : fallback;
}

function asPixKeyTypesByCountryMap(value: unknown, fallback: Record<Country, PixKeyTypeConfig[]>) {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    BR: asPixKeyTypeConfigArray(value.BR, fallback.BR)
  };
}

function asPixKeyCountryDefaults(value: unknown, fallback: PixKeyCountryDefaults): PixKeyCountryDefaults {
  if (!isRecord(value)) {
    return fallback;
  }
  const defaultBackType = asString(value.defaultBackType ?? value.default_back_type, fallback.defaultBackType).trim();
  const phoneDialCode = asString(value.phoneDialCode ?? value.phone_dial_code, fallback.phoneDialCode).replace(/\D/g, "");
  return {
    defaultBackType: defaultBackType || fallback.defaultBackType,
    phoneDialCode: phoneDialCode || fallback.phoneDialCode
  };
}

function asPixKeyDefaultsByCountryMap(value: unknown, fallback: Record<Country, PixKeyCountryDefaults>) {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    BR: asPixKeyCountryDefaults(value.BR, fallback.BR)
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
  const title = asString(value.title, fallback.title);
  const htmlFromConfig = typeof value.html === "string" ? value.html : "";
  const legacyMessage = asString(value.message, "");
  const legacyEmoji = asString(value.emoji, "");
  const html =
    htmlFromConfig.trim() ||
    (legacyMessage || legacyEmoji
      ? buildLegacyOrderStatusHtml(legacyEmoji, legacyMessage)
      : "") ||
    fallback.html;
  return { title, html };
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
    cancelled: asString(value.cancelled, fallback.cancelled),
    reproved: asString(value.reproved, fallback.reproved)
  };
}

function asOrderPageSellPayNetworkWarningConfig(
  value: unknown,
  fallback: OrderPageSellPayNetworkWarningConfig
): OrderPageSellPayNetworkWarningConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    ariaLabel: asString(value.ariaLabel, fallback.ariaLabel),
    bullets: asStringArray(value.bullets, fallback.bullets)
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
    sellCopyWalletAddressButtonLabel: asString(value.sellCopyWalletAddressButtonLabel, fallback.sellCopyWalletAddressButtonLabel),
    sellCopiedWalletAddressButtonLabel: asString(
      value.sellCopiedWalletAddressButtonLabel,
      fallback.sellCopiedWalletAddressButtonLabel
    ),
    sellWalletAddressLabel: asString(value.sellWalletAddressLabel, fallback.sellWalletAddressLabel),
    sellPayNetworkWarning: asOrderPageSellPayNetworkWarningConfig(
      value.sellPayNetworkWarning,
      fallback.sellPayNetworkWarning
    ),
    sellDepositNetworkNotice: asString(value.sellDepositNetworkNotice, fallback.sellDepositNetworkNotice),
    buyPaymentOwnershipNotice: asString(value.buyPaymentOwnershipNotice, fallback.buyPaymentOwnershipNotice),
    buyLabel: asString(value.buyLabel, fallback.buyLabel),
    sellLabel: asString(value.sellLabel, fallback.sellLabel),
    waitingMessage: asString(value.waitingMessage, fallback.waitingMessage),
    paymentSubmittedButtonLabel: asString(value.paymentSubmittedButtonLabel, fallback.paymentSubmittedButtonLabel),
    undoPaymentSubmittedButtonLabel: asString(
      value.undoPaymentSubmittedButtonLabel,
      fallback.undoPaymentSubmittedButtonLabel
    ),
    paymentSubmitted: asOrderStatusContentConfig(value.paymentSubmitted, fallback.paymentSubmitted),
    paymentTimeout: asOrderStatusContentConfig(value.paymentTimeout, fallback.paymentTimeout),
    paymentProcessing: asOrderStatusContentConfig(
      isRecord(value) ? (value.paymentProcessing ?? value.paymentRecognized) : value,
      fallback.paymentProcessing
    ),
    orderConcluded: asOrderStatusContentConfig(value.orderConcluded, fallback.orderConcluded),
    paymentUpdateTimeout: asOrderStatusContentConfig(value.paymentUpdateTimeout, fallback.paymentUpdateTimeout),
    orderUpdateTimeout: asOrderStatusContentConfig(value.orderUpdateTimeout, fallback.orderUpdateTimeout),
    paymentReproved: asOrderStatusContentConfig(value.paymentReproved, fallback.paymentReproved),
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

function asPaymentFormTextsConfig(value: unknown, fallback: PaymentFormTextsConfig): PaymentFormTextsConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    pixKeyOwnerRejected: asString(value.pixKeyOwnerRejected, fallback.pixKeyOwnerRejected),
    pixKeyInvalid: asString(value.pixKeyInvalid, fallback.pixKeyInvalid)
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

function asBiometryPreConfirmConfig(value: unknown, fallback: BiometryPreConfirmConfig): BiometryPreConfirmConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    onboardingTitle: asString(value.onboardingTitle, fallback.onboardingTitle),
    onboardingDescription: asString(value.onboardingDescription, fallback.onboardingDescription),
    paymentTitle: asString(value.paymentTitle, fallback.paymentTitle),
    paymentDescription: asString(value.paymentDescription, fallback.paymentDescription)
  };
}

function asBiometryReviewConfig(value: unknown, fallback: BiometryReviewConfig): BiometryReviewConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  const ttlHours = Math.max(1, asNonNegativeNumber(value.ttlHours, fallback.ttlHours));
  return {
    pendingUserMessage: asString(value.pendingUserMessage, fallback.pendingUserMessage),
    ttlHours,
    duplicateOnboardingMessage: asString(value.duplicateOnboardingMessage, fallback.duplicateOnboardingMessage),
    duplicateWalletMessage: asString(value.duplicateWalletMessage, fallback.duplicateWalletMessage),
    emailMessageTypeApprovedOnboarding: asString(
      value.emailMessageTypeApprovedOnboarding,
      fallback.emailMessageTypeApprovedOnboarding
    ),
    emailMessageTypeDeclinedOnboarding: asString(
      value.emailMessageTypeDeclinedOnboarding,
      fallback.emailMessageTypeDeclinedOnboarding
    ),
    emailMessageTypeExpiredOnboarding: asString(
      value.emailMessageTypeExpiredOnboarding,
      fallback.emailMessageTypeExpiredOnboarding
    ),
    emailMessageTypeApprovedWallet: asString(
      value.emailMessageTypeApprovedWallet,
      fallback.emailMessageTypeApprovedWallet
    ),
    emailMessageTypeDeclinedWallet: asString(
      value.emailMessageTypeDeclinedWallet,
      fallback.emailMessageTypeDeclinedWallet
    ),
    emailMessageTypeExpiredWallet: asString(value.emailMessageTypeExpiredWallet, fallback.emailMessageTypeExpiredWallet)
  };
}

function asFooterConfig(value: unknown, fallback: FooterConfig): FooterConfig {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    title: asString(value.title, fallback.title),
    description: asString(value.description, fallback.description),
    legalInfoLeft: asString(value.legalInfoLeft ?? value.legalInfo, fallback.legalInfoLeft),
    legalInfoRight: asString(value.legalInfoRight, fallback.legalInfoRight),
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
    faviconUrl: asOptionalString(raw.faviconUrl),
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
    documentTypesByCountry: asDocumentTypesByCountryMap(raw.documentTypesByCountry, fallback.documentTypesByCountry),
    pixKeyDefaultsByCountry: asPixKeyDefaultsByCountryMap(raw.pixKeyDefaultsByCountry, fallback.pixKeyDefaultsByCountry),
    pixKeyTypesByCountry: asPixKeyTypesByCountryMap(raw.pixKeyTypesByCountry, fallback.pixKeyTypesByCountry),
    companyDocumentTypes: asCountryStringArrayMap(raw.companyDocumentTypes, fallback.companyDocumentTypes),
    occupations,
    occupationsAvailable: asOccupationsAvailable(
      raw.occupationsAvailable ?? (raw as { ocupationsAvaiables?: unknown }).ocupationsAvaiables,
      fallback.occupationsAvailable,
      occupations
    ),
    tradeAvailabilityTexts: asTradeAvailabilityTextsConfig(raw.tradeAvailabilityTexts, fallback.tradeAvailabilityTexts),
    paymentFormTexts: asPaymentFormTextsConfig(raw.paymentFormTexts, fallback.paymentFormTexts),
    biometryReview: asBiometryReviewConfig(raw.biometryReview, fallback.biometryReview),
    biometryPreConfirm: asBiometryPreConfirmConfig(raw.biometryPreConfirm, fallback.biometryPreConfirm),
    emailConsentLabel: asOptionalString(raw.emailConsentLabel) ?? "",
    footer: asFooterConfig(raw.footer, fallback.footer),
    backend: {
      companyKey: asString(backend.companyKey, fallback.backend.companyKey),
      platform: asString(backend.platform, fallback.backend.platform),
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
      orderBaseUrl: asQuoteBaseUrl(endpoints.orderBaseUrl, fallback.endpoints.orderBaseUrl)
    },
    orderLoading: asOrderLoadingConfig(raw.orderLoading, fallback.orderLoading),
    orderPersistence: asOrderPersistenceConfig(raw.orderPersistence, fallback.orderPersistence),
    orderPage: asOrderPageConfig(raw.orderPage, fallback.orderPage),
    theme: asThemeConfig(raw.theme, fallback.theme)
  };
}
