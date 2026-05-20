import type { Country, Customer, Limits, PaymentContext, PaymentData } from "../types";

export interface ClientsDatabaseConfig {
  companyKey: string;
  platform: string;
  localPaymentAssetByCountry: Record<Country, string>;
}

interface ClientsDatabaseResponse<T> {
  success: boolean;
  data: T | null;
}

interface ClientRow {
  id: string;
  platform: string;
  country: string;
  birth_date?: string | null;
  document?: string | null;
  email?: string | null;
  approved_kyc_result?: string | null;
  kyc_date?: number | null;
  person_type?: string | null;
  kyc_name?: string | null;
  last_successful_biometric?: number | null;
  email_verified?: boolean | null;
  email_pending_verification?: string | null;
  transactional_limit?: unknown;
  waiting_response?: string | null;
  waiting_url?: string | null;
  created_at?: number | null;
  last_updated_at?: number | null;
}

interface WalletRow {
  id: string;
  platform: string;
  country: string;
  asset: string;
  address?: string | null;
  network?: string | null;
}

export interface ApprovedCustomerPayload {
  email: string;
  documentNumber: string;
  personType: string;
  kycName: string | null;
  birthDate: string | null;
  approvedKycResult: string;
  kycDate: number;
  lastSuccessfulBiometric: number;
  emailVerified: boolean;
}

const BANK_KEY_TYPE_TO_NETWORK: Record<string, string> = {
  Telefone: "phone",
  Email: "email",
  Documento: "document",
  Aleatoria: "random"
};

const BANK_NETWORK_TO_KEY_TYPE: Record<string, string> = {
  phone: "Telefone",
  email: "Email",
  document: "Documento",
  random: "Aleatoria"
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hasRowData<T>(data: T | null): data is T {
  if (!data || typeof data !== "object") {
    return false;
  }

  return Object.keys(data as Record<string, unknown>).length > 0;
}

function getPaymentStorageAsset(config: ClientsDatabaseConfig, context: PaymentContext) {
  if (context.tradeSide === "buy") {
    return context.asset;
  }
  return config.localPaymentAssetByCountry[context.country] ?? context.asset;
}

function toBankNetwork(bankKeyType?: string) {
  if (!bankKeyType) return "phone";
  return BANK_KEY_TYPE_TO_NETWORK[bankKeyType] ?? bankKeyType.toLowerCase();
}

function toBankKeyType(network?: string) {
  if (!network) return "Telefone";
  return BANK_NETWORK_TO_KEY_TYPE[network] ?? network;
}

function normalizeTransactionalLimit(value: unknown): Limits {
  if (typeof value === "number" && Number.isFinite(value)) {
    return {
      daily: value,
      monthly: value
    };
  }

  if (value && typeof value === "object") {
    const maybeDaily = Number((value as { daily?: unknown }).daily);
    const maybeMonthly = Number((value as { monthly?: unknown }).monthly);
    return {
      daily: Number.isFinite(maybeDaily) ? maybeDaily : 50000,
      monthly: Number.isFinite(maybeMonthly) ? maybeMonthly : 300000
    };
  }

  return {
    daily: 50000,
    monthly: 300000
  };
}

function normalizeTransactionalLimitValue(value: unknown): number | Record<string, number> | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const maybeDaily = Number((value as { daily?: unknown }).daily);
    const maybeMonthly = Number((value as { monthly?: unknown }).monthly);
    const normalized: Record<string, number> = {};

    if (Number.isFinite(maybeDaily)) {
      normalized.daily = maybeDaily;
    }
    if (Number.isFinite(maybeMonthly)) {
      normalized.monthly = maybeMonthly;
    }

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  return null;
}

async function postToClientsDatabase<T>(
  _config: ClientsDatabaseConfig,
  payload: unknown
): Promise<ClientsDatabaseResponse<T>> {
  const response = await fetch("/webhook/clients_database", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`clients_database request failed with status ${response.status}`);
  }

  return (await response.json()) as ClientsDatabaseResponse<T>;
}

function buildEmailVerificationClientData(config: ClientsDatabaseConfig, email: string, row: ClientRow | null) {
  const normalizedEmail = normalizeEmail(email);
  return {
    platform: config.platform,
    id: normalizedEmail,
    country: config.companyKey,
    email: row?.email ?? normalizedEmail,
    document: row?.document ?? null,
    birth_date: row?.birth_date ?? null,
    approved_kyc_result: row?.approved_kyc_result ?? null,
    kyc_date: row?.kyc_date ?? null,
    person_type: row?.person_type ?? null,
    kyc_name: row?.kyc_name ?? null,
    last_successful_biometric: row?.last_successful_biometric ?? null,
    email_verified: row?.email_verified ?? false,
    email_pending_verification: row?.email_pending_verification ?? null,
    transactional_limit: row?.transactional_limit ?? null,
    waiting_response: row?.waiting_response ?? null,
    waiting_url: row?.waiting_url ?? null,
    created_at: row?.created_at ?? null,
    last_updated_at: row?.last_updated_at ?? null
  };
}

function normalizeCustomer(row: ClientRow): Customer {
  return {
    id: row.id,
    email: row.email ?? row.id,
    companyKey: row.country,
    platform: row.platform,
    birthDate: row.birth_date ?? null,
    documentNumber: row.document ?? undefined,
    documentType: row.person_type ?? undefined,
    personType: row.person_type ?? undefined,
    approvedKycResult: row.approved_kyc_result ?? null,
    kycApproved: row.approved_kyc_result === "approved",
    kycDate: row.kyc_date ?? null,
    kycName: row.kyc_name ?? null,
    fullName: row.kyc_name ?? undefined,
    lastSuccessfulBiometric: row.last_successful_biometric ?? null,
    biometricApproved: Boolean(row.last_successful_biometric),
    emailVerified: Boolean(row.email_verified),
    emailPendingVerification: row.email_pending_verification ?? null,
    transactionalLimit: normalizeTransactionalLimitValue(row.transactional_limit),
    waitingResponse: row.waiting_response ?? null,
    waitingUrl: row.waiting_url ?? null,
    createdAt: row.created_at ?? null,
    lastUpdatedAt: row.last_updated_at ?? null
  };
}

function normalizePaymentData(row: WalletRow, context: PaymentContext): PaymentData {
  if (context.tradeSide === "buy") {
    return {
      email: context.email,
      tradeSide: context.tradeSide,
      asset: context.asset,
      country: context.country,
      kind: "crypto",
      network: row.network ?? undefined,
      walletAddress: row.address ?? undefined,
      storageAsset: row.asset
    };
  }

  return {
    email: context.email,
    tradeSide: context.tradeSide,
    asset: context.asset,
    country: context.country,
    kind: "bank",
    bankKeyType: toBankKeyType(row.network ?? undefined),
    bankKeyValue: row.address ?? undefined,
    storageAsset: row.asset
  };
}

export async function queryClient(config: ClientsDatabaseConfig, email: string): Promise<ClientRow | null> {
  const response = await postToClientsDatabase<ClientRow>(config, {
    action: "query",
    table: "clients",
    primary_keys: {
      id: normalizeEmail(email),
      platform: config.platform,
      country: config.companyKey
    }
  });

  return response.success && hasRowData(response.data) ? response.data : null;
}

export async function queryWallet(config: ClientsDatabaseConfig, context: PaymentContext): Promise<WalletRow | null> {
  const response = await postToClientsDatabase<WalletRow>(config, {
    action: "query",
    table: "wallet",
    primary_keys: {
      id: normalizeEmail(context.email),
      platform: config.platform,
      country: config.companyKey,
      asset: getPaymentStorageAsset(config, context)
    }
  });

  return response.success && hasRowData(response.data) ? response.data : null;
}

export async function lookupCustomerByEmailHttp(config: ClientsDatabaseConfig, email: string) {
  const row = await queryClient(config, email);
  const customer = row ? normalizeCustomer(row) : null;
  const isFullyApproved = Boolean(customer?.emailVerified && customer.kycApproved && customer.biometricApproved);
  return {
    exists: isFullyApproved,
    customer
  };
}

export async function sendOtpEmailHttp(
  config: ClientsDatabaseConfig,
  email: string,
  timestamp: number
): Promise<{ ok: boolean; codePreview: string }> {
  void timestamp;
  const normalizedEmail = normalizeEmail(email);
  const sendEmailEndpoint = "/webhook/clients_database/send-email";
  const row = await queryClient(config, normalizedEmail);
  const clientData = buildEmailVerificationClientData(config, normalizedEmail, row);
  const response = await fetch(sendEmailEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      platform: config.platform,
      id: normalizedEmail,
      country: config.companyKey,
      message_type: "email_verification",
      email: normalizedEmail,
      client_data: clientData
    })
  });

  if (!response.ok) {
    throw new Error(`send_email request failed with status ${response.status}`);
  }

  return (await response.json()) as { ok: boolean; codePreview: string };
}

export async function verifyOtpEmailHttp(email: string, code: string): Promise<{ ok: boolean }> {
  const normalizedEmail = normalizeEmail(email);
  const response = await fetch("/webhook/clients_database/verify-otp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: normalizedEmail,
      code: code.trim()
    })
  });
  if (response.ok) {
    return (await response.json()) as { ok: boolean };
  }
  if (response.status === 400) {
    return { ok: false };
  }
  throw new Error(`verify_otp request failed with status ${response.status}`);
}

export async function getProfileAndLimitsHttp(config: ClientsDatabaseConfig, email: string): Promise<{ customer: Customer; limits: Limits }> {
  const row = await queryClient(config, email);
  if (!row) {
    throw new Error(`Customer ${email} not found in clients_database`);
  }

  return {
    customer: normalizeCustomer(row),
    limits: normalizeTransactionalLimit(row.transactional_limit)
  };
}

export async function getPaymentDataHttp(config: ClientsDatabaseConfig, context: PaymentContext): Promise<PaymentData | null> {
  const row = await queryWallet(config, context);
  if (!row?.address || !row.network) {
    return null;
  }
  return normalizePaymentData(row, context);
}

export async function savePaymentDataHttp(config: ClientsDatabaseConfig, paymentData: PaymentData): Promise<{ ok: boolean }> {
  const storageAsset = getPaymentStorageAsset(config, paymentData);
  const existing = await queryWallet(config, paymentData);
  const payload =
    paymentData.kind === "crypto"
      ? {
          asset: storageAsset,
          address: paymentData.walletAddress ?? "",
          network: paymentData.network ?? ""
        }
      : {
          asset: storageAsset,
          address: paymentData.bankKeyValue ?? "",
          network: toBankNetwork(paymentData.bankKeyType)
        };

  if (existing) {
    await postToClientsDatabase(config, {
      action: "update",
      table: "wallet",
      primary_keys: {
        id: normalizeEmail(paymentData.email),
        platform: config.platform,
        country: config.companyKey,
        asset: storageAsset
      },
      data: payload
    });
  } else {
    await postToClientsDatabase(config, {
      action: "insert",
      table: "wallet",
      data: {
        id: normalizeEmail(paymentData.email),
        platform: config.platform,
        country: config.companyKey,
        ...payload
      }
    });
  }

  return { ok: true };
}

export async function finalizeApprovedCustomerOnboardingHttp(
  config: ClientsDatabaseConfig,
  payload: ApprovedCustomerPayload
): Promise<Customer> {
  const existing = await queryClient(config, payload.email);
  const data = {
    document: payload.documentNumber,
    birth_date: payload.birthDate,
    email: normalizeEmail(payload.email),
    approved_kyc_result: payload.approvedKycResult,
    kyc_date: payload.kycDate,
    person_type: payload.personType,
    kyc_name: payload.kycName,
    last_successful_biometric: payload.lastSuccessfulBiometric,
    email_verified: payload.emailVerified,
    email_pending_verification: null,
    transactional_limit: null,
    waiting_response: null,
    waiting_url: null
  };

  if (existing) {
    await postToClientsDatabase(config, {
      action: "update",
      table: "clients",
      primary_keys: {
        id: normalizeEmail(payload.email),
        platform: config.platform,
        country: config.companyKey
      },
      data
    });
  } else {
    await postToClientsDatabase(config, {
      action: "insert",
      table: "clients",
      data: {
        id: normalizeEmail(payload.email),
        platform: config.platform,
        country: config.companyKey,
        ...data
      }
    });
  }

  const profile = await getProfileAndLimitsHttp(config, payload.email);
  return profile.customer;
}

export async function syncApprovedBiometricHttp(
  config: ClientsDatabaseConfig,
  email: string,
  biometricTimestamp: number
): Promise<Customer | null> {
  const current = await queryClient(config, email);
  if (!current) {
    return null;
  }

  await postToClientsDatabase(config, {
    action: "update",
    table: "clients",
    primary_keys: {
      id: normalizeEmail(email),
      platform: config.platform,
      country: config.companyKey
    },
    data: {
      last_successful_biometric: biometricTimestamp
    }
  });

  const profile = await getProfileAndLimitsHttp(config, email);
  return profile.customer;
}

export async function syncCounterpartyKycHttp(
  config: ClientsDatabaseConfig,
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
  const current = await queryClient(config, email);
  const data = {
    document: payload.documentNumber,
    birth_date: payload.birthDate,
    email: normalizeEmail(email),
    approved_kyc_result: payload.approvedKycResult,
    kyc_date: payload.kycDate,
    person_type: payload.personType,
    kyc_name: payload.kycName
  };

  if (current) {
    await postToClientsDatabase(config, {
      action: "update",
      table: "clients",
      primary_keys: {
        id: normalizeEmail(email),
        platform: config.platform,
        country: config.companyKey
      },
      data
    });
  } else {
    await postToClientsDatabase(config, {
      action: "insert",
      table: "clients",
      data: {
        id: normalizeEmail(email),
        platform: config.platform,
        country: config.companyKey,
        last_successful_biometric: null,
        email_verified: false,
        email_pending_verification: null,
        transactional_limit: null,
        waiting_response: null,
        waiting_url: null,
        ...data
      }
    });
  }

  const profile = await getProfileAndLimitsHttp(config, email);
  return profile.customer;
}
