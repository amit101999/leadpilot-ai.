import { env } from "@/lib/configuration/env";
import type { AiEvaluator } from "@/modules/ai/evaluator";
import { OpenAiEvaluator } from "@/modules/ai/openai-evaluator";
import { ImportJobSourceProvider } from "@/modules/job-sources/import-provider";
import type { JobSourceProvider } from "@/modules/job-sources/types";
import { BrevoEmailProvider } from "@/modules/notifications/brevo-email";
import type { EmailProvider } from "@/modules/notifications/email-provider";
import { SmtpEmailProvider } from "@/modules/notifications/smtp-email";

/**
 * External integrations behind interfaces. Business logic receives a Providers object and never
 * constructs clients itself, so tests can substitute fakes. The app always uses the real ones: jobs
 * come only from the Upwork sync (import), scores from OpenAI, e-mail from SMTP or Brevo. A provider
 * that is not configured reports NOT_CONFIGURED instead of pretending to work.
 */
export interface Providers {
  jobSource: JobSourceProvider;
  ai: AiEvaluator;
  email: EmailProvider;
}

let cached: Providers | undefined;
let override: Providers | undefined;

/**
 * Fakes installed for a whole test process (integration tests, or the browser tests' server). Kept on
 * globalThis so every server bundle of the process sees the same value.
 */
const TEST_PROVIDERS = Symbol.for("leadpilot.testProviders");
type WithTestProviders = typeof globalThis & { [TEST_PROVIDERS]?: Providers };

export function getProviders(): Providers {
  if (override) return override;
  const installed = (globalThis as WithTestProviders)[TEST_PROVIDERS];
  if (installed) return installed;
  if (cached) return cached;
  const config = env();
  cached = {
    jobSource: new ImportJobSourceProvider(),
    ai: new OpenAiEvaluator(config.OPENAI_API_KEY, config.OPENAI_MODEL, config.OPENAI_TIMEOUT_MS),
    email: createEmailProvider(config),
  };
  return cached;
}

function createEmailProvider(config: ReturnType<typeof env>): EmailProvider {
  if (config.EMAIL_PROVIDER === "brevo") {
    return new BrevoEmailProvider({
      apiKey: config.BREVO_API_KEY,
      from: config.EMAIL_FROM,
      timeoutMs: config.BREVO_TIMEOUT_MS,
    });
  }
  return new SmtpEmailProvider({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    user: config.SMTP_USER,
    password: config.SMTP_PASSWORD,
    from: config.EMAIL_FROM,
    timeoutMs: config.SMTP_TIMEOUT_MS,
  });
}

/** Tests only: replace the providers for the current test (undefined restores the default). */
export function setProvidersForTesting(providers: Providers | undefined): void {
  override = providers;
}

/** Tests only: install fakes as the default providers of this process (undefined removes them). */
export function installTestProviders(providers: Providers | undefined): void {
  (globalThis as WithTestProviders)[TEST_PROVIDERS] = providers;
}
