import pino from "pino";

/**
 * Structured JSON logger. Field names follow the observability contract:
 * request_id, run_id, profile_id, job_id, workflow_stage, error_code.
 * Secrets and personal data are redacted by path as a second line of defence;
 * callers must still avoid logging them.
 */
const REDACT_PATHS = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "authorization",
  "*.authorization",
  "headers.cookie",
  "*.headers.cookie",
  "cookie",
  "apiKey",
  "*.apiKey",
  "secret",
  "*.secret",
  "phone",
  "*.phone",
  "phoneE164",
  "*.phoneE164",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "leadpilot-web" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  formatters: { level: (label) => ({ severity: label }) },
});

export interface LogContext {
  request_id?: string;
  run_id?: string;
  profile_id?: string;
  job_id?: string;
  workflow_stage?: string;
  error_code?: string;
}

export function childLogger(context: LogContext): pino.Logger {
  return logger.child(context);
}
