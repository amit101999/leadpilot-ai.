import { env } from "@/lib/configuration/env";
import type { AiEvaluator } from "@/modules/ai/evaluator";
import { MockAiEvaluator } from "@/modules/ai/mock-evaluator";
import { OpenAiEvaluator } from "@/modules/ai/openai-evaluator";
import { MockJobSourceProvider } from "@/modules/job-sources/mock-provider";
import type { JobSourceProvider } from "@/modules/job-sources/types";
import { UpworkJobSourceProvider } from "@/modules/job-sources/upwork-provider";
import { CloudWhatsAppProvider } from "@/modules/notifications/cloud-whatsapp";
import type { EmailProvider } from "@/modules/notifications/email-provider";
import { MockEmailProvider } from "@/modules/notifications/mock-email";
import { MockWhatsAppProvider } from "@/modules/notifications/mock-whatsapp";
import type { WhatsAppProvider } from "@/modules/notifications/provider";
import { SmtpEmailProvider } from "@/modules/notifications/smtp-email";

/**
 * External integrations behind interfaces, selected by environment. Business
 * logic receives a Providers object and never constructs clients itself, so
 * tests can inject mocks and the app never calls a live service unless it is
 * explicitly configured.
 */
export interface Providers {
  jobSource: JobSourceProvider;
  ai: AiEvaluator;
  whatsapp: WhatsAppProvider;
  email: EmailProvider;
}

let cached: Providers | undefined;
let override: Providers | undefined;

export function getProviders(): Providers {
  if (override) return override;
  if (cached) return cached;
  const config = env();
  cached = {
    jobSource:
      config.JOB_SOURCE_PROVIDER === "upwork"
        ? new UpworkJobSourceProvider(
            { clientId: config.UPWORK_CLIENT_ID, clientSecret: config.UPWORK_CLIENT_SECRET },
            config.UPWORK_JOB_SEARCH_SCOPE_CONFIRMED,
          )
        : new MockJobSourceProvider(config.MOCK_SOURCE_SCENARIO),
    ai:
      config.AI_PROVIDER === "openai"
        ? new OpenAiEvaluator(config.OPENAI_API_KEY, config.OPENAI_MODEL, config.OPENAI_TIMEOUT_MS)
        : new MockAiEvaluator(),
    whatsapp:
      config.WHATSAPP_PROVIDER === "cloud"
        ? new CloudWhatsAppProvider({
            accessToken: config.WHATSAPP_ACCESS_TOKEN,
            phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
            graphApiVersion: config.WHATSAPP_GRAPH_API_VERSION,
            language: config.WHATSAPP_TEMPLATE_LANGUAGE,
            templates: {
              lead: config.WHATSAPP_TEMPLATE_NAME,
              summary: config.WHATSAPP_SUMMARY_TEMPLATE_NAME,
              test: config.WHATSAPP_TEST_TEMPLATE_NAME,
            },
            timeoutMs: config.WHATSAPP_TIMEOUT_MS,
          })
        : new MockWhatsAppProvider(),
    email:
      config.EMAIL_PROVIDER === "smtp"
        ? new SmtpEmailProvider({
            host: config.SMTP_HOST,
            port: config.SMTP_PORT,
            secure: config.SMTP_SECURE,
            user: config.SMTP_USER,
            password: config.SMTP_PASSWORD,
            from: config.EMAIL_FROM,
            timeoutMs: config.SMTP_TIMEOUT_MS,
          })
        : new MockEmailProvider(),
  };
  return cached;
}

/** Test hook. Pass undefined to restore environment-based providers. */
export function setProvidersForTesting(providers: Providers | undefined): void {
  override = providers;
}
