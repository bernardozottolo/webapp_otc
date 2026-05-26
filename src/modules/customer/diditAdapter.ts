import { otcApiClient } from "../../shared/api/client";
import { attachDiditVerificationIframeMobileLayout } from "./diditIframeLayout";
import {
  createBiometricSessionFromDocument,
  createDiditSession,
  findApprovedDocumentVerification,
  getDiditSdkMode,
  getDiditSessionDecision,
  getExpectedDetails,
   shouldUseBiometricValidation,
  useMockDiditProxy
} from "../../shared/api/diditProxy";
import { sendFrontendTelemetryEvent } from "../../shared/api/telemetry";
import type {
  DiditBiometricResult,
  DiditFlowKind,
  DiditSessionStatus,
  StartDiditBiometricInput
} from "../../shared/types";

interface DiditSdkCompletionResult {
  type: "completed" | "cancelled" | "failed";
  session?: {
    sessionId?: string;
    status?: string;
  };
  error?: {
    type?: string;
    message?: string;
  };
}

interface DiditSdkShared {
  onComplete?: (result: DiditSdkCompletionResult) => void;
  startVerification: (options: {
    url: string;
    configuration?: {
      loggingEnabled?: boolean;
      closeModalOnComplete?: boolean;
      showExitConfirmation?: boolean;
      showCloseButton?: boolean;
      embedded?: boolean;
    };
  }) => void;
  destroy?: () => void;
}

function isApprovedStatus(status?: DiditSessionStatus) {
  return status === "Approved";
}

function cleanupSdk(shared: DiditSdkShared) {
  shared.onComplete = undefined;
  shared.destroy?.();
}

async function openDiditSdkModal(url: string, onVerificationOpened?: () => void) {
  const sdkModule = (await import("@didit-protocol/sdk-web")) as unknown as {
    DiditSdk: { shared: DiditSdkShared };
  };
  const shared = sdkModule.DiditSdk.shared;
  let releaseIframeLayout = attachDiditVerificationIframeMobileLayout();

  return new Promise<DiditSdkCompletionResult>((resolve) => {
    shared.onComplete = (result) => {
      releaseIframeLayout();
      releaseIframeLayout = () => {};
      cleanupSdk(shared);
      resolve(result);
    };

    shared.startVerification({
      url,
      configuration: {
        loggingEnabled: true,
        closeModalOnComplete: true,
        showExitConfirmation: true,
        showCloseButton: true,
        embedded: getDiditSdkMode() !== "modal"
      }
    });
    onVerificationOpened?.();
  });
}

export async function startBiometricSession(input: StartDiditBiometricInput): Promise<DiditBiometricResult> {
  if (useMockDiditProxy()) {
    return otcApiClient.runBiometric(input);
  }

  const approvedDocumentVerification = await findApprovedDocumentVerification(input.documentNumber);
  const portraitImage = approvedDocumentVerification?.decision.idVerifications[0]?.portraitImage ?? null;
  const useFaceMatchOnly = shouldUseBiometricValidation(input.reason, Boolean(portraitImage));
  const flowKind: DiditFlowKind = useFaceMatchOnly ? "biometric_validation" : "document_verification";

  if (!useFaceMatchOnly && !getExpectedDetails(input.kycName, input.birthDate)) {
    return {
      approved: false,
      provider: "Didit SDK",
      flowKind,
      sessionStatus: "Declined",
      errorCode: "document_verification_missing",
      decision: null
    };
  }

  const sessionInput = {
    documentNumber: input.documentNumber,
    locale: input.locale,
    reason: input.reason,
    asset: input.asset,
    email: input.email,
    kycName: input.kycName,
    birthDate: input.birthDate,
    companyDocumentNumber: input.companyDocumentNumber,
    lastSuccessfulBiometric: input.lastSuccessfulBiometric
  };

  let session;
  try {
    session = useFaceMatchOnly
      ? await createBiometricSessionFromDocument(sessionInput)
      : await createDiditSession({
          flowKind: "document_verification",
          ...sessionInput
        });
  } catch (error) {
    const errorCode = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
    if (errorCode === "expected_details_required") {
      return {
        approved: false,
        provider: "Didit SDK",
        flowKind,
        sessionStatus: "Declined",
        errorCode: "document_verification_missing",
        decision: null
      };
    }
    throw error;
  }

  void sendFrontendTelemetryEvent({
    event: "frontend_didit_session_created",
    step: "bio",
    user_context: {
      email: input.email,
      document_number: input.documentNumber,
      company_document_number: input.companyDocumentNumber ?? null
    },
    payload: {
      reason: input.reason,
      flow_kind: flowKind,
      used_approved_document_verification: useFaceMatchOnly,
      session,
      approved_document_verification: approvedDocumentVerification
    }
  });

  const sdkResult = await openDiditSdkModal(session.verificationUrl, input.onVerificationOpened);
  const sessionId = sdkResult.session?.sessionId ?? session.sessionId;
  const sdkStatus = (sdkResult.session?.status ?? session.status) as DiditSessionStatus;

  if (sdkResult.type === "cancelled") {
    return {
      approved: false,
      provider: "Didit SDK",
      flowKind,
      sessionId,
      sessionStatus: sdkStatus,
      errorCode: "cancelled",
      decision: null
    };
  }

  if (sdkResult.type === "failed") {
    return {
      approved: false,
      provider: "Didit SDK",
      flowKind,
      sessionId,
      sessionStatus: sdkStatus,
      errorCode: "failed",
      decision: null
    };
  }

  try {
    const decision = await getDiditSessionDecision(sessionId);
    return {
      approved: isApprovedStatus(decision.status),
      provider: "Didit SDK",
      flowKind,
      sessionId,
      sessionStatus: decision.status,
      decision
    };
  } catch {
    return {
      approved: isApprovedStatus(sdkStatus),
      provider: "Didit SDK",
      flowKind,
      sessionId,
      sessionStatus: sdkStatus,
      decision: null
    };
  }
}
