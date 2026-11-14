import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  RUN_EXECUTOR: z.enum(["n8n", "inprocess"]).default("inprocess"),
  N8N_BASE_URL: optionalString,
  N8N_WEBHOOK_PATH: z.string().default("/webhook/leadpilot-run"),
  N8N_WEBHOOK_SECRET: optionalString,
  INTERNAL_API_SECRET: optionalString,
  RUN_LEASE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  AI_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(5),
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  NOTIFY_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(5),

  AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),

  EMAIL_PROVIDER: z.enum(["mock", "smtp"]).default("mock"),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  /** "true" = TLS from the first byte (usually port 465); "false" = STARTTLS when the server offers it. */
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  /** Sender, e.g. "LeadPilot <alerts@example.com>". */
  EMAIL_FROM: optionalString,
  SMTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),

  /** Scheduled (unattended) Upwork syncs get no due profiles until this is "true"; manual syncs always work. */
  UPWORK_SYNC_SCHEDULED_ALLOWED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  JOB_SOURCE_PROVIDER: z.enum(["mock", "upwork"]).default("mock"),
  JOB_SOURCE_API_BASE_URL: optionalString,
  JOB_SOURCE_API_KEY: optionalString,
  UPWORK_CLIENT_ID: optionalString,
  UPWORK_CLIENT_SECRET: optionalString,
  /** Must be set explicitly once Upwork has granted job-search access. */
  UPWORK_JOB_SEARCH_SCOPE_CONFIRMED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MOCK_SOURCE_SCENARIO: z.string().default("default"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Parses process.env lazily so `next build` and unit tests do not require
 * runtime secrets. Throws a readable error listing invalid variable *names* only.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test hook: forget the cached environment after mutating process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
