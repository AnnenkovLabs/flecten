export type ErrorCode =
  | "invalid_input"
  | "provider_failed"
  | "context_overflow"
  | "provider_limit"
  | "cancelled";

export class HarnessError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HarnessError";
    this.code = code;
  }
}

/** A provider limit ended the run: the kind and, when known, the reset time for the UI. */
export class LimitError extends HarnessError {
  readonly limit: "rate" | "five_hour" | "weekly" | "billing";
  readonly resetAt: number | undefined;

  constructor(
    message: string,
    limit: LimitError["limit"],
    resetAt: number | undefined,
    options?: { cause?: unknown },
  ) {
    super("provider_limit", message, options);
    this.name = "LimitError";
    this.limit = limit;
    this.resetAt = resetAt;
  }
}

/** A provider has no API key: the environment variable that would hold it, for the settings hint. */
export class MissingKeyError extends HarnessError {
  readonly provider: string;
  readonly env: string;

  constructor(provider: string, env: string) {
    super(
      "provider_failed",
      `provider "${provider}" needs ${env}; set it in the environment or in settings`,
    );
    this.name = "MissingKeyError";
    this.provider = provider;
    this.env = env;
  }
}

/** Another live core works in the project; its pid and the lock file go into the message. */
export class ProjectLockedError extends Error {
  readonly pid: number;
  readonly path: string;

  constructor(pid: number, path: string) {
    super(
      `project is open in another Flecten process (pid ${pid}); close it, or delete ${path} if that process is not Flecten`,
    );
    this.name = "ProjectLockedError";
    this.pid = pid;
    this.path = path;
  }
}
