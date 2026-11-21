import { afterEach, describe, expect, it } from "vitest";
import { register } from "@/instrumentation";
import { getProviders, installTestProviders } from "@/modules/providers";

const saved = { ...process.env };

function setEnv(values: Record<string, string>) {
  Object.assign(
    process.env,
    { NEXT_RUNTIME: "nodejs", E2E_FAKE_PROVIDERS: "1", MIGRATE_ON_START: "false" },
    values,
  );
}

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, saved);
  installTestProviders(undefined);
});

describe("E2E_FAKE_PROVIDERS start-up switch", () => {
  it("refuses the fakes unless APP_BASE_URL is a localhost address", async () => {
    for (const url of ["https://leads.example.com", "http://localhost.example.com", "not a url", ""]) {
      setEnv({ APP_BASE_URL: url });
      await expect(register()).rejects.toThrow(/only allowed when APP_BASE_URL is a localhost address/);
    }
  });

  it("installs the fakes for a localhost APP_BASE_URL", async () => {
    setEnv({ APP_BASE_URL: "http://127.0.0.1:3100" });
    await register();
    expect(getProviders().jobSource.id).toBe("mock");
    expect(getProviders().email.id).toBe("mock");
  });

  it("does nothing without the switch", async () => {
    setEnv({ APP_BASE_URL: "https://leads.example.com", E2E_FAKE_PROVIDERS: "" });
    await expect(register()).resolves.toBeUndefined();
  });
});
