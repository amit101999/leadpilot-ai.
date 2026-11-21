import type { Providers } from "@/modules/providers";
import { MockEmailProvider } from "./mock-email";
import { MockAiEvaluator } from "./mock-evaluator";
import { MockJobSourceProvider } from "./mock-job-source";

/**
 * Fake job source (demo jobs), AI and e-mail for the automated tests. Never part of the app's
 * configuration: integration tests install them per file, and the browser tests through the guarded
 * E2E_FAKE_PROVIDERS switch (src/instrumentation.ts).
 */
export function createFakeProviders(): Providers {
  return {
    jobSource: new MockJobSourceProvider(),
    ai: new MockAiEvaluator(),
    email: new MockEmailProvider(),
  };
}
