import OpenAI from "openai";
import type { AiEvaluator, EvaluationInput } from "./evaluator";
import { AiProviderError } from "./evaluator";
import { aiOutputJsonSchema } from "./output-schema";
import { buildUserMessage, SYSTEM_INSTRUCTIONS } from "./prompts/v1";

/**
 * OpenAI Responses API with strict JSON-schema structured output. Retries are
 * handled by the qualification service (bounded by the profile's maxRetries),
 * so the SDK's own retries are disabled to keep attempts countable.
 */
export class OpenAiEvaluator implements AiEvaluator {
  readonly id = "openai";
  readonly isMock = false;
  private client: OpenAI | null = null;

  readonly model: string;

  constructor(
    private readonly apiKey: string | undefined,
    model: string | undefined,
    private readonly timeoutMs: number,
  ) {
    this.model = model ?? "";
  }

  checkConfiguration() {
    if (!this.apiKey) return { configured: false, message: "OPENAI_API_KEY is not set" };
    if (!this.model) return { configured: false, message: "OPENAI_MODEL is not set" };
    return { configured: true, message: `OpenAI model ${this.model}` };
  }

  async evaluate(input: EvaluationInput): Promise<unknown> {
    if (!this.checkConfiguration().configured) {
      throw new AiProviderError("OpenAI is not configured", "NOT_CONFIGURED");
    }
    this.client ??= new OpenAI({ apiKey: this.apiKey, maxRetries: 0 });
    try {
      const response = await this.client.responses.create(
        {
          model: this.model,
          instructions: SYSTEM_INSTRUCTIONS,
          input: buildUserMessage(input),
          text: {
            format: {
              type: "json_schema",
              name: "job_evaluation",
              schema: aiOutputJsonSchema(),
              strict: true,
            },
          },
          // Job text must not be retained for training or reused across requests.
          store: false,
        },
        { timeout: this.timeoutMs },
      );
      return response.output_text;
    } catch (error) {
      if (error instanceof OpenAI.APIConnectionTimeoutError) {
        throw new AiProviderError("OpenAI request timed out", "TIMEOUT");
      }
      if (error instanceof OpenAI.RateLimitError)
        throw new AiProviderError("OpenAI rate limit", "RATE_LIMIT");
      if (error instanceof OpenAI.APIError) {
        throw new AiProviderError(`OpenAI API error (status ${error.status ?? "n/a"})`, "PROVIDER");
      }
      throw new AiProviderError("OpenAI request failed", "PROVIDER");
    }
  }
}
