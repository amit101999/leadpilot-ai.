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
  /**
   * Optional single admin login defined by the server settings (no seed, no user management): sign in with this
   * username and password. Both or neither. The app keeps one matching ADMIN user row in sync on login.
   */
  ADMIN_USERNAME: optionalString.pipe(
    z
      .string()
      .regex(/^[A-Za-z0-9._-]{3,64}$/, "use 3-64 letters, digits, '.', '_' or '-'")
      .transform((v) => v.toLowerCase())
      .optional(),
  ),
  ADMIN_PASSWORD: optionalString.pipe(z.string().min(8, "must be at least 8 characters").max(256).optional()),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  RUN_LEASE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  AI_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(5),
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  NOTIFY_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(5),

  AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),

  /** smtp = any mail server; brevo = Brevo HTTPS API (for hosts that block SMTP ports, e.g. Render free). */
  EMAIL_PROVIDER: z.enum(["mock", "smtp", "brevo"]).default("mock"),
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
  BREVO_API_KEY: optionalString,
  BREVO_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),

  /** Scheduled (unattended) Upwork syncs get no due profiles until this is "true"; manual syncs always work. */
  UPWORK_SYNC_SCHEDULED_ALLOWED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /**
   * Where runs get jobs: "import" = only jobs delivered by the Upwork sync (Claude + Upwork connector) through the
   * import API; "upwork" = the official Upwork API (blocked until a key is approved); "mock" = demo jobs (dev/tests).
   */
  JOB_SOURCE_PROVIDER: z.enum(["mock", "upwork", "import"]).default("mock"),
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

  /** Lets a production build run with mock AI or e-mail (e2e tests, or a deliberate trial before keys exist). */
  ALLOW_MOCK_PROVIDERS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

/**
 * Fails closed in production: a forgotten setting must not quietly turn into fake scores or e-mails that
 * are never sent. The app then fails its health check, so a deploy stops with this message in the logs.
 */
const envSchemaWithGuards = envSchema.superRefine((config, ctx) => {
  if (Boolean(config.ADMIN_USERNAME) !== Boolean(config.ADMIN_PASSWORD)) {
    ctx.addIssue({
      code: "custom",
      path: [config.ADMIN_USERNAME ? "ADMIN_PASSWORD" : "ADMIN_USERNAME"],
      message: "ADMIN_USERNAME and ADMIN_PASSWORD must be set together",
    });
  }
  if (config.NODE_ENV !== "production" || config.ALLOW_MOCK_PROVIDERS) return;
  for (const name of ["AI_PROVIDER", "EMAIL_PROVIDER"] as const) {
    if (config[name] === "mock") {
      ctx.addIssue({
        code: "custom",
        path: [name],
        message:
          "is 'mock' in production; set the real provider, or ALLOW_MOCK_PROVIDERS=true to run with mocks",
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Parses process.env lazily so `next build` and unit tests do not require
 * runtime secrets. Throws a readable error listing invalid variable *names* only.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = envSchemaWithGuards.safeParse(process.env);
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
