import { describe, expect, it, vi } from "vitest";
import { AiProviderError, type EvaluationInput } from "@/modules/ai/evaluator";
import { OpenAiEvaluator } from "@/modules/ai/openai-evaluator";
import { makeAiOutput, makeJob } from "../fixtures/jobs";

const KEY = "sk-test-secret-key";
const MODEL = "test-model";

const input: EvaluationInput = {
  job: makeJob(),
  profile: { requiredSkills: ["React"], optionalSkills: [], category: null, riskSensitivity: "MEDIUM" },
};

/** Minimal Responses API body: the SDK derives `output_text` from the message content. */
function responseBody(text: string) {
  return {
    id: "resp_1",
    object: "response",
    created_at: 0,
    status: "completed",
    model: MODEL,
    output: [
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
  };
}

function respond(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

async function evaluationError(fetchMock: typeof fetch, timeoutMs = 1000) {
  const error = await new OpenAiEvaluator(KEY, MODEL, timeoutMs, fetchMock)
    .evaluate(input)
    .catch((e: unknown) => e as AiProviderError);
  expect(error).toBeInstanceOf(AiProviderError);
  expect((error as AiProviderError).message).not.toContain(KEY);
  return error as AiProviderError;
}

describe("OpenAiEvaluator.evaluate", () => {
  it("requests strict JSON-schema output without storing the job, and returns the model text", async () => {
    const text = JSON.stringify(makeAiOutput(88));
    const fetchMock = respond(200, responseBody(text));
    const result = await new OpenAiEvaluator(KEY, MODEL, 1000, fetchMock).evaluate(input);
    expect(result).toBe(text);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: MODEL,
      store: false,
      text: { format: { type: "json_schema", strict: true, name: "job_evaluation" } },
    });
    expect(body.input).toContain(input.job.title);
    expect(fetchMock).toHaveBeenCalledTimes(1); // SDK retries are off; the caller counts attempts
  });

  it("classifies rate limits, server errors and timeouts", async () => {
    expect((await evaluationError(respond(429, { error: { message: "slow down" } }))).kind).toBe(
      "RATE_LIMIT",
    );
    expect((await evaluationError(respond(500, { error: { message: "boom" } }))).kind).toBe("PROVIDER");

    const hang = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          ),
        ),
    );
    expect((await evaluationError(hang as unknown as typeof fetch, 20)).kind).toBe("TIMEOUT");
  });

  it("refuses to run without a key or model and never calls the API", async () => {
    const fetchMock = respond(200, {});
    const error = await new OpenAiEvaluator(undefined, MODEL, 1000, fetchMock)
      .evaluate(input)
      .catch((e) => e);
    expect(error).toMatchObject({ kind: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("OpenAiEvaluator.checkConnection", () => {
  it("maps the model lookup to connection states", async () => {
    const check = (fetchMock: typeof fetch) =>
      new OpenAiEvaluator(KEY, MODEL, 1000, fetchMock).checkConnection();
    expect((await check(respond(200, { id: MODEL, object: "model" }))).state).toBe("CONNECTED");
    expect((await check(respond(401, { error: { message: "bad key" } }))).state).toBe("NOT_AUTHORIZED");
    expect((await check(respond(404, { error: { message: "no model" } }))).state).toBe("NOT_CONFIGURED");
  });
});
