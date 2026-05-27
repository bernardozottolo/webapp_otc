export type BiometryPendingAction = "onboarding" | "wallet_save";

export interface BiometryPendingCheckResult {
  blocked: boolean;
  message?: string;
  sessionId?: string;
}

export interface RegisterBiometryPendingInput {
  sessionId: string;
  sessionStatus: string;
  action: BiometryPendingAction;
  email: string;
  asset?: string;
  actionPayload: Record<string, unknown>;
}

export interface RegisterBiometryPendingResult {
  ok: boolean;
  sessionId: string;
  message: string;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) {
        detail = body.detail;
      }
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  const body = (await response.json()) as { success?: boolean; data?: T };
  return (body.data ?? body) as T;
}

export async function checkBiometryPending(
  action: BiometryPendingAction,
  email: string,
  asset?: string,
  documentNumber?: string
): Promise<BiometryPendingCheckResult> {
  const params = new URLSearchParams({
    action,
    email: email.trim().toLowerCase()
  });
  if (asset?.trim()) {
    params.set("asset", asset.trim().toUpperCase());
  }
  if (documentNumber?.trim()) {
    params.set("document_number", documentNumber.trim());
  }
  const response = await fetch(`/webhook/biometry-pending/check?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  return parseJsonResponse<BiometryPendingCheckResult>(response);
}

export interface NotifyImmediateBiometryApprovalInput {
  email: string;
  asset?: string;
  sessionId?: string;
}

export async function notifyBiometryImmediateApproval(
  input: NotifyImmediateBiometryApprovalInput
): Promise<{ ok: boolean }> {
  const response = await fetch("/webhook/biometry-pending/notify-immediate-approval", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "wallet_save",
      email: input.email.trim().toLowerCase(),
      asset: input.asset?.trim().toUpperCase(),
      session_id: input.sessionId?.trim()
    })
  });
  return parseJsonResponse<{ ok: boolean }>(response);
}

export async function registerBiometryPending(
  input: RegisterBiometryPendingInput
): Promise<RegisterBiometryPendingResult> {
  const response = await fetch("/webhook/biometry-pending/register", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      session_id: input.sessionId,
      session_status: input.sessionStatus,
      action: input.action,
      email: input.email.trim().toLowerCase(),
      asset: input.asset?.trim().toUpperCase(),
      action_payload: input.actionPayload
    })
  });
  return parseJsonResponse<RegisterBiometryPendingResult>(response);
}
