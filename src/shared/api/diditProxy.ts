import type { BrandConfig } from "../../whitelabel/config";
import { effectiveDiditProxyBaseUrl } from "../../whitelabel/config";
import type {
  DiditBiometryReason,
  DiditDecision,
  DiditFlowKind,
  DiditSessionStatus,
  DiditSessionSummary,
  Locale
} from "../types";

export interface DiditProxyConfig {
  apiBaseUrl: string;
  documentVerificationValidityDays: number;
  sdkMode: "modal";
}

interface DiditProxyResponse<T> {
  success?: boolean;
  data?: T;
  results?: T[];
  error?: string;
}

interface DiditSessionResponse {
  session_id?: string;
  sessionId?: string;
  status?: string;
  vendor_data?: string;
  vendorData?: string;
  workflow_id?: string;
  workflowId?: string;
  verification_completed_at_ms?: number;
  verificationCompletedAtMs?: number;
  verification_url?: string;
  verificationUrl?: string;
  session_url?: string;
  sessionUrl?: string;
  url?: string;
  session_token?: string;
  sessionToken?: string;
}

interface DiditDecisionResponse {
  session_id?: string;
  sessionId?: string;
  status?: string;
  vendor_data?: string;
  vendorData?: string;
  verification_completed_at_ms?: number;
  verificationCompletedAtMs?: number;
  metadata?: {
    document?: string | null;
    name?: string | null;
    waiting_url?: string | null;
    vendor_data?: string | null;
  };
  idVerification?: {
    status?: string;
    portraitImage?: string | null;
    documentNumber?: string | null;
    documentType?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
  };
  id_verification?: {
    status?: string;
    portrait_image?: string | null;
    document_number?: string | null;
    document_type?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
  };
  idVerifications?: Array<{
    status?: string;
    portraitImage?: string | null;
    documentNumber?: string | null;
    documentType?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
  }>;
  id_verifications?: Array<{
    status?: string;
    portrait_image?: string | null;
    document_number?: string | null;
    document_type?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
  }>;
}

export type DiditPendingAction = "onboarding" | "wallet_save";

export interface CreateDiditSessionInput {
  flowKind: DiditFlowKind;
  documentNumber: string;
  locale: Locale;
  reason: DiditBiometryReason;
  asset?: string;
  email?: string;
  kycName?: string | null;
  birthDate?: string | null;
  companyDocumentNumber?: string | null;
  lastSuccessfulBiometric?: number | null;
}

export interface CreateDiditSessionResult {
  sessionId: string;
  sessionToken?: string;
  verificationUrl: string;
  status: DiditSessionStatus;
}

export type DiditExpectedDetails = {
  first_name: string;
  date_of_birth: string;
};

export function getExpectedDetails(
  name: string | null | undefined,
  birthDate: string | null | undefined
): DiditExpectedDetails | undefined {
  const firstName = (name ?? "").trim().split(/\s+/).filter(Boolean)[0] ?? "";
  const normalizedBirthDate = (birthDate ?? "").trim();
  if (!firstName || !normalizedBirthDate) {
    return undefined;
  }
  return {
    first_name: firstName,
    date_of_birth: normalizedBirthDate
  };
}

export function requireExpectedDetails(
  name: string | null | undefined,
  birthDate: string | null | undefined
): DiditExpectedDetails {
  const details = getExpectedDetails(name, birthDate);
  if (!details) {
    throw Object.assign(
      new Error("first_name and date_of_birth are required for document verification."),
      { code: "expected_details_required" as const }
    );
  }
  return details;
}

let diditProxyConfig: DiditProxyConfig = {
  apiBaseUrl: "mock://didit",
  documentVerificationValidityDays: 365,
  sdkMode: "modal"
};

function buildDiditUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function buildDiditUrlForUrlConstructor(baseUrl: string, path: string) {
  const resolved = buildDiditUrl(baseUrl, path);
  if (/^https?:\/\//i.test(resolved)) {
    return new URL(resolved);
  }
  return new URL(resolved, window.location.origin);
}

function normalizeDocument(documentNumber: string) {
  return documentNumber.replace(/\D/g, "");
}

function mapLocaleToDiditLanguage(locale: Locale) {
  if (locale === "pt-BR") return "pt";
  return "en";
}

function normalizeDiditStatus(status?: string | null): DiditSessionStatus {
  if (!status) return "Declined";

  const normalizedCode = status.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const byCode: Record<string, DiditSessionStatus> = {
    NOT_STARTED: "Not Started",
    IN_PROGRESS: "In Progress",
    IN_REVIEW: "In Review",
    APPROVED: "Approved",
    DECLINED: "Declined",
    ABANDONED: "Abandoned",
    EXPIRED: "Expired",
    PENDING: "Pending",
    AWAITING_USER: "Pending"
  };

  return byCode[normalizedCode] ?? status;
}

function isApprovedStatus(status?: string | null) {
  return normalizeDiditStatus(status) === "Approved";
}

/** Parses Didit timestamps: ISO strings, UNIX seconds/ms, millis. */
function parseDiditMaybeTimestamp(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e14) return Math.floor(value);
    if (value > 1e12) return Math.floor(value);
    if (value > 1e9) return Math.floor(value * 1000);
    return null;
  }
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return null;

      return parseDiditMaybeTimestamp(n);
    }
    const ms = Date.parse(trimmed);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** Preference order focuses on completion/approval-ish fields before generic updated/created. */
const VERIFICATION_TIME_KEYS = [
  "completed_at",
  "completedAt",
  "approval_completed_at",
  "approvalCompletedAt",
  "approved_at",
  "approvedAt",
  "evaluation_completed_at",
  "evaluationCompletedAt",
  "decision_completed_at",
  "decisionCompletedAt",
  "verified_at",
  "verifiedAt",
  "decision_date",
  "decisionDate",
  "updated_at",
  "updatedAt",
  "created_at",
  "createdAt"
];

function pickVerificationCompletedAt(record: Record<string, unknown>): number | null {
  for (const key of VERIFICATION_TIME_KEYS) {
    const parsed = parseDiditMaybeTimestamp(record[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function pickVerificationCompletedAtDeep(value: unknown, depth = 0): number | null {
  if (!value || typeof value !== "object" || depth > 8) return null;

  const direct = pickVerificationCompletedAt(value as Record<string, unknown>);
  if (direct != null) return direct;

  if (Array.isArray(value)) {
    for (const element of value) {
      const inner = pickVerificationCompletedAtDeep(element, depth + 1);
      if (inner != null) return inner;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  const nestedPaths = ["decision", "metadata", "session", "session_update", "sessionUpdate", "raw", "evaluation"];
  for (const path of nestedPaths) {
    const next = record[path];
    if (next && typeof next === "object") {
      const inner = pickVerificationCompletedAtDeep(next, depth + 1);
      if (inner != null) return inner;
    }
  }
  return null;
}

function normalizeSession(session: DiditSessionResponse): DiditSessionSummary {
  const raw = session as DiditSessionResponse & Record<string, unknown>;
  const verificationCompletedAtMs =
    session.verification_completed_at_ms ?? session.verificationCompletedAtMs ?? pickVerificationCompletedAtDeep(raw);
  return {
    sessionId: session.session_id ?? session.sessionId ?? "",
    status: normalizeDiditStatus(session.status),
    vendorData: session.vendor_data ?? session.vendorData ?? "",
    workflowId: session.workflow_id ?? session.workflowId,
    verificationCompletedAtMs
  };
}

function getDecisionIdVerifications(response: DiditDecisionResponse) {
  const plural = response.id_verifications ?? response.idVerifications;
  if (plural && plural.length > 0) {
    return plural;
  }

  const single = response.id_verification ?? response.idVerification;
  return single ? [single] : [];
}

function normalizeIdVerificationItem(
  item:
    | NonNullable<DiditDecisionResponse["idVerifications"]>[number]
    | NonNullable<DiditDecisionResponse["id_verifications"]>[number]
    | NonNullable<DiditDecisionResponse["idVerification"]>
    | NonNullable<DiditDecisionResponse["id_verification"]>
) {
  const snakeCaseItem = item as {
    status?: string;
    portrait_image?: string | null;
    document_number?: string | null;
    document_type?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
  };
  const camelCaseItem = item as {
    status?: string;
    portraitImage?: string | null;
    documentNumber?: string | null;
    documentType?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
  };

  return {
    status: normalizeDiditStatus(item.status),
    portraitImage: snakeCaseItem.portrait_image ?? camelCaseItem.portraitImage ?? null,
    documentNumber: snakeCaseItem.document_number ?? camelCaseItem.documentNumber ?? null,
    documentType: snakeCaseItem.document_type ?? camelCaseItem.documentType ?? null,
    firstName: snakeCaseItem.first_name ?? camelCaseItem.firstName ?? null,
    lastName: snakeCaseItem.last_name ?? camelCaseItem.lastName ?? null,
    fullName: snakeCaseItem.full_name ?? camelCaseItem.fullName ?? null
  };
}

function normalizeDecision(response: DiditDecisionResponse): DiditDecision {
  const raw = response as DiditDecisionResponse & Record<string, unknown>;
  const idVerifications = getDecisionIdVerifications(response);
  const verificationCompletedAtMs =
    response.verification_completed_at_ms ?? response.verificationCompletedAtMs ?? pickVerificationCompletedAtDeep(raw);
  return {
    sessionId: response.session_id ?? response.sessionId,
    status: normalizeDiditStatus(response.status),
    vendorData: response.vendor_data ?? response.vendorData ?? response.metadata?.vendor_data ?? undefined,
    verificationCompletedAtMs,
    idVerifications: idVerifications.map(normalizeIdVerificationItem)
  };
}

async function parseProxyResponse<T>(response: Response): Promise<DiditProxyResponse<T>> {
  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { detail?: string; message?: string } | null;
    throw new Error(errorPayload?.detail ?? errorPayload?.message ?? `Didit proxy request failed with status ${response.status}`);
  }

  return (await response.json()) as DiditProxyResponse<T>;
}

function unwrapDiditDecisionPayload(payload: unknown): DiditDecisionResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid Didit decision payload.");
  }

  const record = payload as Record<string, unknown>;

  if (record.data) {
    return unwrapDiditDecisionPayload(record.data);
  }

  if (record.session_update && typeof record.session_update === "object") {
    const sessionUpdate = record.session_update as Record<string, unknown>;
    const rawRecord =
      sessionUpdate.raw && typeof sessionUpdate.raw === "object" ? (sessionUpdate.raw as Record<string, unknown>) : undefined;
    const nestedDecision =
      (sessionUpdate.decision && typeof sessionUpdate.decision === "object" ? sessionUpdate.decision : null) ??
      (rawRecord &&
      rawRecord.decision &&
      typeof rawRecord.decision === "object"
        ? (rawRecord.decision as Record<string, unknown>)
        : null);
    const nestedDecisionRecord = nestedDecision as Record<string, unknown> | null;

    return {
      ...(nestedDecisionRecord ?? {}),
      session_id:
        (sessionUpdate.session_id as string | undefined) ??
        (rawRecord?.session_id as string | undefined) ??
        (nestedDecisionRecord?.session_id as string | undefined),
      status:
        (sessionUpdate.status as string | undefined) ??
        (rawRecord?.status as string | undefined) ??
        (nestedDecisionRecord?.status as string | undefined),
      vendor_data:
        (sessionUpdate.vendor_data as string | undefined) ??
        (rawRecord?.vendor_data as string | undefined) ??
        (nestedDecisionRecord?.vendor_data as string | undefined)
    } as DiditDecisionResponse;
  }

  return record as DiditDecisionResponse;
}

export function resolveDiditAction(reason: DiditBiometryReason, asset?: string): string {
  if (reason === "onboarding") {
    return "register_client";
  }
  const normalizedAsset = (asset ?? "").trim().toUpperCase();
  if (!normalizedAsset) {
    throw new Error("asset is required for payment Didit biometry");
  }
  return `register_wallet_${normalizedAsset}`;
}

export function buildDiditVendorData(
  documentNumber: string,
  flowKind: DiditFlowKind,
  action: string
): string {
  const normalized = normalizeDocument(documentNumber);
  if (!normalized) {
    throw new Error("documentNumber is required");
  }
  return `${normalized}_${flowKind}_${action}`;
}

export function buildDiditSearch(
  documentNumber: string,
  flowKind: DiditFlowKind,
  action: string
): string {
  return buildDiditVendorData(documentNumber, flowKind, action);
}

function resolveVendorData(
  documentNumber: string,
  flowKind: DiditFlowKind,
  reason: DiditBiometryReason,
  asset?: string
) {
  return buildDiditVendorData(documentNumber, flowKind, resolveDiditAction(reason, asset));
}

export function configureDiditProxy(brand: BrandConfig) {
  diditProxyConfig = {
    apiBaseUrl: effectiveDiditProxyBaseUrl(brand.backend.didit.apiBaseUrl),
    documentVerificationValidityDays: brand.backend.didit.documentVerificationValidityDays,
    sdkMode: brand.backend.didit.sdkMode
  };
}

export function getDiditProxyConfig() {
  return diditProxyConfig;
}

export function useMockDiditProxy() {
  return diditProxyConfig.apiBaseUrl.startsWith("mock://");
}

export function getDiditSdkMode() {
  return diditProxyConfig.sdkMode;
}

export async function createDiditSession(input: CreateDiditSessionInput): Promise<CreateDiditSessionResult> {
  const expectedDetails =
    input.flowKind === "document_verification"
      ? requireExpectedDetails(input.kycName, input.birthDate)
      : getExpectedDetails(input.kycName, input.birthDate);

  const sessionBody: Record<string, unknown> = {
    flow_kind: input.flowKind,
    language: mapLocaleToDiditLanguage(input.locale),
    vendor_data: resolveVendorData(input.documentNumber, input.flowKind, input.reason, input.asset),
    metadata: {
      email: input.email,
      name: input.kycName,
      document: normalizeDocument(input.documentNumber),
      cnpj: input.companyDocumentNumber ? normalizeDocument(input.companyDocumentNumber) : undefined,
      last_successful_biometric: input.lastSuccessfulBiometric
    }
  };
  if (expectedDetails) {
    sessionBody.expected_details = expectedDetails;
  }

  const response = await fetch(buildDiditUrl(diditProxyConfig.apiBaseUrl, "/webhook/didit/session"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(sessionBody)
  });

  const payload = await parseProxyResponse<DiditSessionResponse>(response);
  const session = payload.data;

  if (!session) {
    throw new Error(payload.error ?? "Unable to create Didit session.");
  }

  return {
    sessionId: session.session_id ?? session.sessionId ?? "",
    sessionToken: session.session_token ?? session.sessionToken,
    verificationUrl:
      session.url ??
      session.session_url ??
      session.sessionUrl ??
      session.verification_url ??
      session.verificationUrl ??
      "",
    status: normalizeDiditStatus(session.status)
  };
}

export async function listDiditSessions(options: {
  search: string;
  status?: DiditSessionStatus;
  limit?: number;
}): Promise<DiditSessionSummary[]> {
  const url = buildDiditUrlForUrlConstructor(diditProxyConfig.apiBaseUrl, "/webhook/didit/sessions");
  url.searchParams.set("search", options.search);
  if (options.status) {
    url.searchParams.set("status", options.status.trim());
  }
  if (options.limit) {
    url.searchParams.set("limit", String(options.limit));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  const payload = await parseProxyResponse<DiditSessionResponse>(response);
  const rows = payload.results ?? (payload.data ? [payload.data] : []);
  return rows.filter((row) => Boolean(row.session_id ?? row.sessionId)).map(normalizeSession);
}

export async function getDiditSessionDecision(sessionId: string): Promise<DiditDecision> {
  const response = await fetch(buildDiditUrl(diditProxyConfig.apiBaseUrl, `/webhook/didit/session/${encodeURIComponent(sessionId)}/decision`), {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  const payload = await parseProxyResponse<unknown>(response);
  const decision = unwrapDiditDecisionPayload(payload.data ?? payload);
  return normalizeDecision(decision);
}

export async function createBiometricSessionFromDocument(input: {
  documentNumber: string;
  locale: Locale;
  reason: DiditBiometryReason;
  asset?: string;
  email?: string;
  kycName?: string | null;
  birthDate?: string | null;
  companyDocumentNumber?: string | null;
  lastSuccessfulBiometric?: number | null;
}): Promise<CreateDiditSessionResult> {
  const response = await fetch(buildDiditUrl(diditProxyConfig.apiBaseUrl, "/webhook/didit/biometric-session-from-document"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      language: mapLocaleToDiditLanguage(input.locale),
      document_verification_vendor_data: resolveVendorData(
        input.documentNumber,
        "document_verification",
        "onboarding"
      ),
      biometric_validation_vendor_data: resolveVendorData(
        input.documentNumber,
        "biometric_validation",
        input.reason,
        input.asset
      ),
      expected_details: getExpectedDetails(input.kycName, input.birthDate),
      metadata: {
        email: input.email,
        name: input.kycName,
        document: normalizeDocument(input.documentNumber),
        cnpj: input.companyDocumentNumber ? normalizeDocument(input.companyDocumentNumber) : undefined,
        last_successful_biometric: input.lastSuccessfulBiometric
      }
    })
  });

  const payload = await parseProxyResponse<DiditSessionResponse>(response);
  const session = payload.data;

  if (!session) {
    throw new Error(payload.error ?? "Unable to create Didit biometric validation session.");
  }

  return {
    sessionId: session.session_id ?? session.sessionId ?? "",
    sessionToken: session.session_token ?? session.sessionToken,
    verificationUrl:
      session.url ??
      session.session_url ??
      session.sessionUrl ??
      session.verification_url ??
      session.verificationUrl ??
      "",
    status: normalizeDiditStatus(session.status)
  };
}

const LIST_APPROVED_DOCUMENT_VERIFICATIONS_LIMIT = 1;

export function documentVerificationPassesAgeCheck(
  completedAtMs: number | null | undefined,
  validityDays: number
): boolean {
  if (validityDays <= 0) {
    return true;
  }

  if (completedAtMs == null || !Number.isFinite(completedAtMs)) {
    return false;
  }

  const maxAgeMs = validityDays * 86400000;
  return Date.now() - completedAtMs <= maxAgeMs;
}

export async function findApprovedDocumentVerification(documentNumber: string) {
  const sessions = await listDiditSessions({
    search: buildDiditSearch(documentNumber, "document_verification", "register_client"),
    status: "Approved",
    limit: LIST_APPROVED_DOCUMENT_VERIFICATIONS_LIMIT
  });

  const session = sessions.find((item) => isApprovedStatus(item.status));
  if (!session) {
    return null;
  }

  const validityDays = diditProxyConfig.documentVerificationValidityDays;
  const decision = await getDiditSessionDecision(session.sessionId);
  const idVerification = decision.idVerifications[0];
  if (!idVerification?.portraitImage) {
    return null;
  }

  const completedMs = decision.verificationCompletedAtMs ?? session.verificationCompletedAtMs ?? null;
  if (!documentVerificationPassesAgeCheck(completedMs, validityDays)) {
    return null;
  }

  return {
    session,
    decision
  };
}

export function shouldUseBiometricValidation(_reason: DiditBiometryReason, hasApprovedDocumentVerification: boolean) {
  return hasApprovedDocumentVerification;
}
