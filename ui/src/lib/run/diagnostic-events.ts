/** Transport diagnostics are retained for replay without becoming conversation content. */
export type DiagnosticEvent =
  | { type: "provider.response"; sessionId: string; response: unknown }
  | {
      type: "context.summary.failed";
      sessionId: string;
      stage: "provider" | "disabled" | "schema";
      reason: string;
    };
