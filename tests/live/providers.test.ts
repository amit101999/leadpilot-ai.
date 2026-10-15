import "dotenv/config";
import { describe, expect, it } from "vitest";
import { OpenAiEvaluator } from "@/modules/ai/openai-evaluator";
import { validateAiOutput } from "@/modules/ai/output-schema";
import { CloudWhatsAppProvider } from "@/modules/notifications/cloud-whatsapp";
import { makeJob } from "../fixtures/jobs";

/**
 * Opt-in checks against the real services, using the credentials in .env:
 *
 *   LIVE_TESTS=1 npx vitest run --project live        (PowerShell: $env:LIVE_TESTS=1; npx vitest run --project live)
 *
 * They cost at most one small OpenAI request and send no WhatsApp message.
 */
const live = process.env.LIVE_TESTS === "1";
const env = process.env;

describe.skipIf(!live || !env.OPENAI_API_KEY || !env.OPENAI_MODEL)("OpenAI (live)", () => {
  const evaluator = new OpenAiEvaluator(env.OPENAI_API_KEY, env.OPENAI_MODEL, 30_000);

  it("accepts the key and finds the configured model", async () => {
    expect(await evaluator.checkConnection()).toMatchObject({ state: "CONNECTED" });
  });

  it("returns output that passes the strict schema for a sample job", async () => {
    const raw = await evaluator.evaluate({
      job: makeJob(),
      profile: {
        requiredSkills: ["React", "Node.js"],
        optionalSkills: [],
        category: null,
        riskSensitivity: "MEDIUM",
      },
    });
    const result = validateAiOutput(raw);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
  });
});

describe.skipIf(!live || !env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID)(
  "WhatsApp Cloud API (live)",
  () => {
    it("accepts the access token for the configured phone number id", async () => {
      const provider = new CloudWhatsAppProvider({
        accessToken: env.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION ?? "v21.0",
        language: env.WHATSAPP_TEMPLATE_LANGUAGE ?? "en_US",
        templates: { lead: env.WHATSAPP_TEMPLATE_NAME ?? "unused" },
        timeoutMs: 15_000,
      });
      expect(await provider.checkConnection()).toMatchObject({ state: "CONNECTED" });
    });
  },
);
