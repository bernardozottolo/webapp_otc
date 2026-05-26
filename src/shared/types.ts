export type Locale = "pt-BR";
export type Country = "BR";
export type PaymentKind = "crypto" | "bank";
export type TradeSide = "buy" | "sell";
export type DiditBiometryReason = "onboarding" | "payment";
export type DiditFlowKind = "document_verification" | "biometric_validation";
export type DiditSdkMode = "modal";
export type DiditSessionStatus =
  | "Not Started"
  | "In Progress"
  | "In Review"
  | "Approved"
  | "Declined"
  | "Abandoned"
  | "Expired"
  | "Pending"
  | string;

export interface PaymentContext {
  email: string;
  tradeSide: TradeSide;
  asset: string;
  country: Country;
}

export interface DiditSessionSummary {
  sessionId: string;
  status: DiditSessionStatus;
  vendorData: string;
  workflowId?: string;
  /** Best-effort completion / approval timestamp (ms) parsed from Didit list payload when present */
  verificationCompletedAtMs?: number | null;
}

export interface DiditDecision {
  sessionId?: string;
  status: DiditSessionStatus;
  vendorData?: string;
  verificationCompletedAtMs?: number | null;
  idVerifications: Array<{
    status?: DiditSessionStatus;
    portraitImage?: string | null;
    documentNumber?: string | null;
    documentType?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
  }>;
}

export interface StartDiditBiometricInput {
  email: string;
  documentNumber: string;
  locale: Locale;
  reason: DiditBiometryReason;
  /** Required when reason is payment (register_wallet_{ASSET}). */
  asset?: string;
  kycName?: string | null;
  birthDate?: string | null;
  companyDocumentNumber?: string | null;
  lastSuccessfulBiometric?: number | null;
  onVerificationOpened?: () => void;
}

export interface DiditBiometricResult {
  approved: boolean;
  provider: string;
  flowKind: DiditFlowKind;
  sessionId?: string;
  sessionStatus?: DiditSessionStatus;
  errorCode?: "cancelled" | "failed" | "document_verification_missing" | "portrait_missing";
  decision?: DiditDecision | null;
}

export interface QuoteRequest {
  tradeSide: TradeSide;
  asset: string;
  amount: number;
  coupon?: string;
  country: Country;
  locale: Locale;
  /** Sent as `client_data` when user is identified */
  customer?: Customer | null;
}

export interface QuoteResponse {
  tradeSide: TradeSide;
  unitPrice: number;
  standardUnitPrice: number;
  finalUnitPrice: number;
  couponIsValid: boolean;
  feePercent: number;
  feeAmount: number;
  inputAmount: number;
  outputAmount: number;
  totalFiat: number;
  updatedAt: string;
}

export interface NegotiationAssetInfo {
  asset: string;
  tradeTypes: Array<"BUY" | "SELL">;
  decimalPrecisionAsset: number;
  decimalPrecisionFiat: number;
  minNegotiationValueFiat: number;
}

/** Result of combining OTC counterparty limit with 30-day transacted fiat history. */
export interface OtcTransactionalAllowance {
  approvedKycLimit: number;
  transactedHistoryAmount: number;
  remainingFiat: number;
}

export interface OtcWithdrawNetwork {
  addressRegex?: string;
  network: string;
  userFriendlyNetworkName: string;
  withdrawDesc?: string;
  withdrawFee: number;
  withdrawFeeBrlEstimate: number;
  withdrawIntegerMultiple?: string;
  withdrawMax?: string;
  withdrawMin?: string;
  withdrawTag?: boolean;
}

export interface OtcWalletRiskCheck {
  approved: boolean;
  riskResult: string;
  wallet: string;
  network: string;
  failureReasons: Record<string, unknown>;
}

export interface OtcPreOrderValidation {
  priceIsValid: boolean;
  couponIsValid: boolean;
  price: number;
  currentValidPrice?: number;
  amountToPay: number;
  defaultNetworkFee: number;
  defaultNetworkFeeBrl: number;
  finalNetworkFee: number;
  finalNetworkFeeBrl: number;
  grossTotalAsset: number;
  netTotalAsset: number;
}

export interface Customer {
  id?: string;
  email: string;
  companyKey?: string;
  platform?: string;
  fullName?: string;
  birthDate?: string | null;
  documentType?: string;
  documentNumber?: string;
  personType?: string;
  kycApproved?: boolean;
  biometricApproved?: boolean;
  approvedKycResult?: string | null;
  kycDate?: number | null;
  kycName?: string | null;
  lastSuccessfulBiometric?: number | null;
  emailVerified?: boolean;
  emailPendingVerification?: string | null;
  transactionalLimit?: number | Record<string, number> | null;
  waitingResponse?: string | null;
  waitingUrl?: string | null;
  createdAt?: number | null;
  lastUpdatedAt?: number | null;
  counterpartyKycFailureReasons?: string[] | null;
}

export interface Limits {
  daily: number;
  monthly: number;
}

export interface PaymentData {
  email: string;
  tradeSide: TradeSide;
  asset: string;
  country: Country;
  kind: PaymentKind;
  storageAsset?: string;
  network?: string;
  walletAddress?: string;
  bankKeyType?: string;
  bankKeyValue?: string;
}

export interface OrderPaymentData {
  BeneficiaryBankName?: string;
  BeneficiaryName?: string;
  BeneficiaryTaxId?: string;
  imagemQRCodeInBase64?: string;
  payload?: string;
  txHash?: string | null;
  txHashUrl?: string | null;
  network?: string;
  walletAddress?: string;
}

export interface Order {
  id: string;
  email: string;
  tradeSide: TradeSide;
  asset: string;
  amount: number;
  quoteTotal: number;
  status: "created" | "processing" | "completed" | "waiting_for_payment" | "payment_confirmed" | "concluded" | "cancelled" | string;
  createdAt: number;
  price?: number;
  amountToPay?: number;
  orderIsValid?: boolean;
  paymentData?: OrderPaymentData | null;
}

export interface OrderUpdatePayload {
  template: string;
  clientId?: string;
  orderInfo: {
    order_id: string;
    status?: string;
    price?: number;
    amount_to_pay?: number;
    total_amount_to_receive?: number;
    fee?: number;
    final_amount_to_receive?: number;
    payment_data?: {
      qr_code?: string;
      tx_hash?: string | null;
      tx_hash_url?: string | null;
      network?: string;
      wallet_address?: string;
    };
  };
  receivedAt: number;
}

export interface StoredOrderRecord {
  order: Order;
  createdAt: number;
  expiresAt: number;
  updates: OrderUpdatePayload[];
  lastUpdatedAt: number;
}

