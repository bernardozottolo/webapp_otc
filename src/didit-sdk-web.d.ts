declare module "@didit-protocol/sdk-web" {
  export const DiditSdk: {
    shared: {
      onComplete?: (result: {
        type: "completed" | "cancelled" | "failed";
        session?: {
          sessionId?: string;
          status?: string;
        };
        error?: {
          type?: string;
          message?: string;
        };
      }) => void;
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
    };
  };
}
