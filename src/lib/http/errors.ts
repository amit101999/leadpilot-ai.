/**
 * Application error with a stable machine-readable code. Only `message` and
 * `details` reach clients; never put secrets or stack traces in either.
 */
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  INVALID_SIGNATURE: 401,
  FORBIDDEN: 403,
  CSRF_REJECTED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  RUN_ALREADY_ACTIVE: 409,
  LEASE_HELD: 409,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  INTEGRATION_NOT_CONFIGURED: 503,
  SOURCE_NOT_AUTHORIZED: 503,
  SOURCE_UNAVAILABLE: 503,
  EXECUTOR_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.status = ERROR_STATUS[code];
  }
}

export const notFound = (entity: string) => new AppError("NOT_FOUND", `${entity} not found`);
export const forbidden = (message = "You do not have permission to perform this action") =>
  new AppError("FORBIDDEN", message);

/** Postgres unique-violation detection (SQLSTATE 23505), optionally for a specific constraint. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = findPgError(error);
  return pg?.code === "23505" && (!constraint || pg.constraint_name === constraint || pg.constraint === constraint);
}

function findPgError(error: unknown): { code?: string; constraint_name?: string; constraint?: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return candidate as { code: string };
    }
    current = candidate.cause;
  }
  return null;
}
