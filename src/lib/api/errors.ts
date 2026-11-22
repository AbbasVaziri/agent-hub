export const ERROR_CODES = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  BUDGET_EXCEEDED: 402,
  PROVIDER_ERROR: 502,
  PROVIDER_AUTH_ERROR: 502,
  OUTBOUND_BLOCKED: 422,
  LIMIT_EXCEEDED: 422,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
  get status(): number {
    return ERROR_CODES[this.code];
  }
}

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`);
export const forbidden = (msg = "You do not have permission for this action") => new AppError("FORBIDDEN", msg);

export type ApiErrorBody = { error: { code: ErrorCode; message: string; details?: unknown } };
