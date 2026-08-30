export type ApplicationErrorCode =
  | "CONFIGURATION_ERROR"
  | "DEPENDENCY_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "UNAUTHORIZED";

export type ValidationIssue = Readonly<{
  field: string;
  message: string;
}>;

type ApplicationErrorOptions = Readonly<{
  cause?: unknown;
  code: Exclude<ApplicationErrorCode, "INTERNAL_ERROR">;
  status: number;
}>;

export class ApplicationError extends Error {
  readonly code: Exclude<ApplicationErrorCode, "INTERNAL_ERROR">;
  readonly status: number;

  constructor(message: string, options: ApplicationErrorOptions) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = new.target.name;
    this.code = options.code;
    this.status = options.status;
  }
}

export class ConfigurationError extends ApplicationError {
  constructor(message = "The requested capability is not configured.") {
    super(message, { code: "CONFIGURATION_ERROR", status: 503 });
  }
}

export class DependencyUnavailableError extends ApplicationError {
  constructor(message = "A required service is temporarily unavailable.", cause?: unknown) {
    super(message, {
      ...(cause === undefined ? {} : { cause }),
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
  }
}

export class UnauthenticatedError extends ApplicationError {
  constructor(message = "Authentication is required.") {
    super(message, { code: "UNAUTHENTICATED", status: 401 });
  }
}

export class UnauthorizedError extends ApplicationError {
  constructor(message = "You are not authorized to perform this action.") {
    super(message, { code: "UNAUTHORIZED", status: 403 });
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message = "The requested resource was not found.") {
    super(message, { code: "NOT_FOUND", status: 404 });
  }
}

export class InputValidationError extends ApplicationError {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[], message = "The request is invalid.") {
    super(message, { code: "INVALID_INPUT", status: 400 });
    this.issues = issues;
  }
}

export type PublicError = Readonly<{
  correlationId: string;
  error: Readonly<{
    code: ApplicationErrorCode;
    message: string;
    issues?: readonly ValidationIssue[];
  }>;
}>;

export function toPublicError(error: unknown, correlationId: string): PublicError {
  if (error instanceof InputValidationError) {
    return {
      correlationId,
      error: {
        code: error.code,
        issues: error.issues,
        message: error.message,
      },
    };
  }

  if (error instanceof ApplicationError) {
    return {
      correlationId,
      error: {
        code: error.code,
        message: error.message,
      },
    };
  }

  return {
    correlationId,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    },
  };
}
