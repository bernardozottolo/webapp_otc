import type {
  Country,
  Customer,
  DiditBiometricResult,
  Limits,
  Locale,
  NegotiationAssetInfo,
  OtcPreOrderValidation,
  OtcWalletRiskCheck,
  OtcWithdrawNetwork,
  OtcPixKeyOwnerCheck,
  Order,
  PaymentContext,
  PaymentData,
  QuoteRequest,
  QuoteResponse,
  OtcTransactionalAllowance,
  StoredOrderRecord,
  StartDiditBiometricInput
} from "../types";
import type { ApprovedCustomerPayload } from "./clientsDatabase";

export interface TransactionalAllowanceInput {
  fiatCurrency: string;
  firstName: string;
  document: string;
  /** Sent as `kyc_result` to `/otc/get_counterparty_transactional_limit` (e.g. `"approve"`). */
  kycResult: string;
}

export interface KycSubmitPayload {
  email: string;
  documentType: string;
  documentNumber: string;
  locale: Locale;
  country: Country;
}

export interface CompanyKycOwnerInfo {
  birthDate: string | null;
  document: string;
  fullName: string;
  relationshipLevel: string;
  relationshipName: string;
  relationshipType: string;
}

export interface KycSubmitResult {
  approved: boolean;
  approvedKycResult: "approved" | "rejected";
  kycDate: number;
  personType: string;
  kycName: string | null;
  birthDate: string | null;
  failureReasons?: string[];
  companyName?: string | null;
  ownersInfo?: CompanyKycOwnerInfo[];
  responseDocument?: string | null;
}

export interface OtcKycInfoPayload {
  name: string;
  document: string;
  kycResult: string;
}

export type BuyOrderPaymentInfo = {
  wallet: string;
  network: string;
};

export type SellOrderPaymentInfo = {
  pixKey: string;
  network: string;
};

export interface BuyPreOrderValidationInput {
  asset: string;
  tradeType: "BUY";
  coupon?: string;
  paymentInfo: BuyOrderPaymentInfo;
  price: number;
  amount: number;
  document: string;
  documentType: string;
  kycInfo: OtcKycInfoPayload;
}

export interface SellPreOrderValidationInput {
  asset: string;
  tradeType: "SELL";
  coupon?: string;
  paymentInfo: SellOrderPaymentInfo;
  networkInfo: OtcWithdrawNetwork;
  price: number;
  amount: number;
  document: string;
  documentType: string;
  kycInfo: OtcKycInfoPayload;
}

export type PreOrderValidationInput = BuyPreOrderValidationInput | SellPreOrderValidationInput;

export interface BuyCreateOrderInput {
  email: string;
  country: Country;
  asset: string;
  assetToPay: string;
  tradeType: "BUY";
  coupon?: string;
  paymentInfo: BuyOrderPaymentInfo;
  price: number;
  amount: number;
  document: string;
  documentType: string;
  kycInfo: OtcKycInfoPayload;
  kycTs: number;
  preOrder: OtcPreOrderValidation;
}

export interface SellCreateOrderInput {
  email: string;
  country: Country;
  asset: string;
  tradeType: "SELL";
  coupon?: string;
  paymentInfo: SellOrderPaymentInfo;
  networkInfo: OtcWithdrawNetwork;
  price: number;
  amount: number;
  document: string;
  documentType: string;
  kycInfo: OtcKycInfoPayload;
  kycTs: number;
  preOrder: OtcPreOrderValidation;
}

export type CreateOrderInput = BuyCreateOrderInput | SellCreateOrderInput;

export interface OtcApi {
  getQuote(req: QuoteRequest): Promise<QuoteResponse>;
  getNegotiationAssets(input: { country: Country; customer?: Customer | null }): Promise<NegotiationAssetInfo[]>;
  getTransactionalAllowance(input: TransactionalAllowanceInput): Promise<OtcTransactionalAllowance>;
  lookupCustomerByEmail(email: string): Promise<{ exists: boolean; customer: Customer | null }>;
  sendOtp(email: string, timestamp: number, userRegistered: boolean): Promise<{ ok: boolean; codePreview: string }>;
  verifyOtp(email: string, code: string): Promise<{ ok: boolean }>;
  getDocumentTypes(country: Country): Promise<string[]>;
  submitKyc(payload: KycSubmitPayload): Promise<KycSubmitResult>;
  runBiometric(input: StartDiditBiometricInput): Promise<DiditBiometricResult>;
  finalizeApprovedCustomerOnboarding(payload: ApprovedCustomerPayload): Promise<Customer>;
  syncApprovedBiometric(email: string, biometricTimestamp: number): Promise<Customer | null>;
  syncCounterpartyKyc(
    email: string,
    payload: Pick<KycSubmitResult, "approvedKycResult" | "kycDate" | "personType" | "kycName" | "birthDate"> & {
      documentNumber: string;
      failureReasons?: string[];
    }
  ): Promise<Customer | null>;
  getProfileAndLimits(email: string): Promise<{ customer: Customer; limits: Limits }>;
  getPaymentData(context: PaymentContext): Promise<PaymentData | null>;
  getNetworksAndFees(country: Country, asset: string): Promise<OtcWithdrawNetwork[]>;
  getDepositNetworks(asset: string): Promise<OtcWithdrawNetwork[]>;
  walletKytCheck(walletAddress: string, network: string): Promise<OtcWalletRiskCheck>;
  bankKeyOwnerCheck(bankKeyValue: string, documentNumber: string): Promise<OtcPixKeyOwnerCheck>;
  savePaymentData(paymentData: PaymentData): Promise<{ ok: boolean }>;
  preValidateOrder(input: PreOrderValidationInput): Promise<OtcPreOrderValidation>;
  createOrder(input: CreateOrderInput): Promise<Order>;
  getOrderStatus(id: string): Promise<Order | null>;
  getOrderRecord(id: string): Promise<StoredOrderRecord | null>;
}
