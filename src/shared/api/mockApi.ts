import { db } from "./mockDb";
import type { CreateOrderInput, KycSubmitResult, PreOrderValidationInput, TransactionalAllowanceInput } from "./contracts";
import type { ApprovedCustomerPayload } from "./clientsDatabase";
import type {
  Country,
  Customer,
  DiditBiometricResult,
  Limits,
  Locale,
  OtcPreOrderValidation,
  Order,
  OtcTransactionalAllowance,
  OtcWalletRiskCheck,
  OtcWithdrawNetwork,
  PaymentContext,
  PaymentData,
  QuoteRequest,
  QuoteResponse,
  StartDiditBiometricInput
} from "../types";

function wait(ms = 500) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomFrom(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 9973;
  return h / 9973;
}

export async function getQuote(req: QuoteRequest): Promise<QuoteResponse> {
  await wait(350);
  const baseByAsset: Record<string, number> = {
    BTC: 385000,
    ETH: 16000,
    USDT: 5.15
  };
  const base = baseByAsset[req.asset.toUpperCase()] ?? 16000;
  const factor = 0.98 + randomFrom(`${req.asset}${Date.now()}`) * 0.04;
  const standardUnitPrice = base * factor;
  const couponCode = req.coupon?.trim().toUpperCase() ?? "";
  const couponIsValid = couponCode === "VIP10" || couponCode === "OTC5";
  const finalUnitPrice = couponIsValid ? standardUnitPrice * 0.97 : standardUnitPrice;
  const unitPrice = finalUnitPrice;
  const feePercent = 0;
  const feeAmount = 0;
  const outputAmount = req.tradeSide === "buy" ? Math.max(req.amount / unitPrice, 0) : Math.max(req.amount * unitPrice, 0);
  const totalFiat = req.tradeSide === "buy" ? req.amount : outputAmount;
  return {
    tradeSide: req.tradeSide,
    unitPrice,
    standardUnitPrice,
    finalUnitPrice,
    couponIsValid,
    feePercent,
    feeAmount,
    inputAmount: req.amount,
    outputAmount,
    totalFiat,
    updatedAt: new Date().toISOString()
  };
}

export async function lookupCustomerByEmail(email: string) {
  await wait();
  const customer = db.customers.get(email.toLowerCase());
  return { exists: Boolean(customer), customer: customer ?? null };
}

export async function sendOtp(email: string, timestamp: number) {
  await wait();
  const code = String((timestamp % 900000) + 100000).slice(0, 6);
  db.otpByEmail.set(email.toLowerCase(), { code, timestamp });
  return { ok: true, codePreview: code };
}

export async function verifyOtp(email: string, code: string) {
  await wait();
  const record = db.otpByEmail.get(email.toLowerCase());
  return { ok: record?.code === code };
}

export async function submitKyc(payload: {
  email: string;
  documentType: string;
  documentNumber: string;
  locale: Locale;
  country: Country;
}): Promise<KycSubmitResult> {
  await wait(700);
  if (payload.documentType.trim().toUpperCase() === "CNPJ") {
    const approved = payload.documentNumber.replace(/\D/g, "").length >= 14;
    return {
      approved,
      approvedKycResult: approved ? "approved" : "rejected",
      kycDate: Date.now(),
      personType: payload.documentType,
      kycName: "GENESIS SERVICOS DIGITAIS LTDA",
      birthDate: null,
      companyName: "GENESIS SERVICOS DIGITAIS LTDA",
      responseDocument: payload.documentNumber.replace(/\D/g, ""),
      ownersInfo: [
        {
          birthDate: "1992-05-27",
          document: "03703935111",
          fullName: "ENZO MENDES MONTOYA LAZO",
          relationshipLevel: "Direct",
          relationshipName: "SOCIO-ADMINISTRADOR",
          relationshipType: "QSA"
        },
        {
          birthDate: "1991-01-18",
          document: "09631408680",
          fullName: "LAURA MENEZES PACHECO",
          relationshipLevel: "Direct",
          relationshipName: "",
          relationshipType: "REPRESENTANTELEGAL"
        }
      ],
      failureReasons: approved ? [] : ["Documento empresarial inválido."]
    };
  }
  const approved = payload.documentNumber.length >= 6;
  const inferredName = payload.email
    .split("@")[0]
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return {
    approved,
    approvedKycResult: approved ? "approved" : "rejected",
    kycDate: Date.now(),
    personType: payload.documentType,
    kycName: inferredName || null,
    birthDate: "2000-02-07"
  };
}

export async function runBiometric(input: StartDiditBiometricInput): Promise<DiditBiometricResult> {
  await wait(900);
  return {
    approved: true,
    provider: "Didit (mock)",
    flowKind: input.reason === "payment" ? "biometric_validation" : "document_verification",
    sessionId: `mock-${input.reason}-${Date.now()}`,
    sessionStatus: "Approved",
    decision: {
      sessionId: `mock-${input.reason}`,
      status: "Approved",
      vendorData: `${input.documentNumber}_${input.reason === "payment" ? "biometric_validation" : "document_verification"}`,
      idVerifications: [
        {
          status: "Approved",
          portraitImage: "mock://portrait-image",
          documentNumber: input.documentNumber,
          documentType: "CPF",
          fullName: input.kycName ?? "Cliente Mock"
        }
      ]
    }
  };
}

export async function finalizeApprovedCustomerOnboarding(payload: ApprovedCustomerPayload): Promise<Customer> {
  await wait(300);
  const email = payload.email.toLowerCase();
  const customer: Customer = {
    id: email,
    email,
    documentType: payload.personType,
    personType: payload.personType,
    documentNumber: payload.documentNumber,
    birthDate: payload.birthDate,
    approvedKycResult: payload.approvedKycResult,
    kycApproved: payload.approvedKycResult === "approved",
    kycDate: payload.kycDate,
    kycName: payload.kycName,
    fullName: payload.kycName ?? undefined,
    lastSuccessfulBiometric: payload.lastSuccessfulBiometric,
    biometricApproved: true,
    emailVerified: payload.emailVerified
  };
  db.customers.set(email, customer);
  return customer;
}

export async function syncApprovedBiometric(email: string, biometricTimestamp: number): Promise<Customer | null> {
  await wait(200);
  const key = email.toLowerCase();
  const current = db.customers.get(key);
  if (!current) {
    return null;
  }

  const updated: Customer = {
    ...current,
    lastSuccessfulBiometric: biometricTimestamp,
    biometricApproved: true
  };
  db.customers.set(key, updated);
  return updated;
}

export async function syncCounterpartyKyc(
  email: string,
  payload: {
    documentNumber: string;
    personType: string;
    kycName: string | null;
    birthDate: string | null;
    approvedKycResult: string;
    kycDate: number;
  }
): Promise<Customer | null> {
  await wait(200);
  const key = email.toLowerCase();
  const current = db.customers.get(key);
  const next: Customer = {
    ...(current ?? {
      id: key,
      email: key,
      emailVerified: false,
      biometricApproved: false
    }),
    documentNumber: payload.documentNumber,
    documentType: payload.personType,
    personType: payload.personType,
    birthDate: payload.birthDate,
    kycName: payload.kycName,
    fullName: payload.kycName ?? current?.fullName,
    approvedKycResult: payload.approvedKycResult,
    kycApproved: payload.approvedKycResult === "approved",
    kycDate: payload.kycDate
  };
  db.customers.set(key, next);
  return next;
}

export async function getTransactionalAllowance(_input: TransactionalAllowanceInput): Promise<OtcTransactionalAllowance> {
  await wait(220);
  return {
    approvedKycLimit: 240000,
    transactedHistoryAmount: 0,
    remainingFiat: 240000
  };
}

export async function getProfileAndLimits(email: string): Promise<{ customer: Customer; limits: Limits }> {
  await wait();
  const customer =
    db.customers.get(email.toLowerCase()) ??
    ({
      email,
      kycApproved: false,
      biometricApproved: false,
      emailVerified: false
    } as Customer);
  const transactionalLimit = customer.transactionalLimit;
  const fallbackLimits = {
    daily: 50000,
    monthly: 300000
  };
  const limits =
    typeof transactionalLimit === "number"
      ? { daily: transactionalLimit, monthly: transactionalLimit }
      : transactionalLimit && typeof transactionalLimit === "object"
        ? {
            daily: Number((transactionalLimit as Record<string, unknown>).daily) || fallbackLimits.daily,
            monthly: Number((transactionalLimit as Record<string, unknown>).monthly) || fallbackLimits.monthly
          }
        : fallbackLimits;
  return {
    customer,
    limits
  };
}

function paymentContextKey(context: PaymentContext) {
  return `${context.email.toLowerCase()}:${context.tradeSide}:${context.asset}:${context.country}`;
}

export async function getPaymentData(context: PaymentContext): Promise<PaymentData | null> {
  await wait(220);
  return db.paymentByContext.get(paymentContextKey(context)) ?? null;
}

export async function getNetworksAndFees(country: Country, asset: string): Promise<OtcWithdrawNetwork[]> {
  await wait(150);
  const normalizedAsset = asset.toUpperCase();
  if (normalizedAsset === "BTC") {
    return country === "BR"
      ? [
          { network: "BTC", userFriendlyNetworkName: "Bitcoin", withdrawFee: 0.0002, withdrawFeeBrlEstimate: 420 },
          { network: "Lightning", userFriendlyNetworkName: "Lightning", withdrawFee: 0.00005, withdrawFeeBrlEstimate: 105 }
        ]
      : [
          { network: "BTC", userFriendlyNetworkName: "Bitcoin", withdrawFee: 0.00025, withdrawFeeBrlEstimate: 525 },
          { network: "Lightning", userFriendlyNetworkName: "Lightning", withdrawFee: 0.00008, withdrawFeeBrlEstimate: 168 }
        ];
  }
  if (normalizedAsset === "ETH") {
    return country === "BR"
      ? [
          { network: "ERC20", userFriendlyNetworkName: "Ethereum", withdrawFee: 0.0012, withdrawFeeBrlEstimate: 19.2 },
          { network: "Arbitrum", userFriendlyNetworkName: "Arbitrum", withdrawFee: 0.0004, withdrawFeeBrlEstimate: 6.4 }
        ]
      : [
          { network: "ERC20", userFriendlyNetworkName: "Ethereum", withdrawFee: 0.0014, withdrawFeeBrlEstimate: 22.4 },
          { network: "Arbitrum", userFriendlyNetworkName: "Arbitrum", withdrawFee: 0.0005, withdrawFeeBrlEstimate: 8 }
        ];
  }
  return country === "BR"
    ? [
        { network: "BSC", userFriendlyNetworkName: "BNB Smart Chain", withdrawFee: 0.3, withdrawFeeBrlEstimate: 1.55 },
        { network: "TRC20", userFriendlyNetworkName: "Tron", withdrawFee: 1.2, withdrawFeeBrlEstimate: 6.18 },
        { network: "ERC20", userFriendlyNetworkName: "Ethereum", withdrawFee: 4.6, withdrawFeeBrlEstimate: 23.69 }
      ]
    : [
        { network: "BSC", userFriendlyNetworkName: "BNB Smart Chain", withdrawFee: 0.35, withdrawFeeBrlEstimate: 1.8 },
        { network: "TRC20", userFriendlyNetworkName: "Tron", withdrawFee: 1.5, withdrawFeeBrlEstimate: 7.73 },
        { network: "ERC20", userFriendlyNetworkName: "Ethereum", withdrawFee: 4.9, withdrawFeeBrlEstimate: 25.24 }
      ];
}

export async function walletKytCheck(walletAddress: string, network: string): Promise<OtcWalletRiskCheck> {
  await wait(600);
  const approved = walletAddress.length > 8;
  return {
    approved,
    riskResult: approved ? "approved" : "rejected",
    wallet: walletAddress,
    network,
    failureReasons: approved ? {} : { wallet: ["Wallet address rejected in mock KYT"] }
  };
}

export async function bankKeyOwnerCheck(bankKeyValue: string, documentNumber: string) {
  await wait(500);
  return { approved: bankKeyValue.length > 5 && documentNumber.length > 5 };
}

export async function savePaymentData(paymentData: PaymentData) {
  await wait(300);
  db.paymentByContext.set(
    paymentContextKey({
      email: paymentData.email,
      tradeSide: paymentData.tradeSide,
      asset: paymentData.asset,
      country: paymentData.country
    }),
    paymentData
  );
  return { ok: true };
}

export async function preValidateOrder(input: PreOrderValidationInput): Promise<OtcPreOrderValidation> {
  await wait(280);
  const price = input.price;
  const amountToPay = input.amount;
  const couponCode = input.coupon?.trim().toUpperCase() ?? "";
  const couponIsValid = couponCode === "VIP10" || couponCode === "OTC5";
  const defaultNetworkFee = input.asset.toUpperCase() === "BTC" ? 0.0002 : 0.3;
  const defaultNetworkFeeBrl = defaultNetworkFee * price;
  const grossTotalAsset = amountToPay / price;
  const netTotalAsset = Math.max(grossTotalAsset - defaultNetworkFee, 0);
  return {
    priceIsValid: true,
    couponIsValid,
    price,
    amountToPay,
    defaultNetworkFee,
    defaultNetworkFeeBrl,
    finalNetworkFee: defaultNetworkFee,
    finalNetworkFeeBrl: defaultNetworkFeeBrl,
    grossTotalAsset,
    netTotalAsset
  };
}

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  await wait(500);
  const id = String(Math.floor(100000000 + Math.random() * 900000000));
  const order: Order = {
    id,
    email: input.email,
    tradeSide: "buy",
    asset: input.asset,
    amount: input.preOrder.netTotalAsset,
    quoteTotal: input.preOrder.amountToPay,
    status: "waiting_for_payment",
    createdAt: Date.now(),
    amountToPay: input.preOrder.amountToPay,
    paymentData: {
      BeneficiaryBankName: "Banco Mock",
      BeneficiaryName: "Mesa OTC Mock",
      BeneficiaryTaxId: "00.000.000/0001-00",
      payload: `PIX-MOCK-${id}`
    },
    price: input.preOrder.price,
    orderIsValid: true
  };
  db.orders.set(id, order);
  return order;
}

export async function getOrderStatus(id: string): Promise<Order | null> {
  await wait(280);
  const order = db.orders.get(id);
  if (!order) return null;
  const elapsed = Date.now() - order.createdAt;
  let status: Order["status"] = "created";
  if (elapsed > 15000) status = "completed";
  else if (elapsed > 6000) status = "processing";
  const updated = { ...order, status };
  db.orders.set(id, updated);
  return updated;
}
