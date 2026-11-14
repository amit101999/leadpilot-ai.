import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke tests. They run against TEST_DATABASE_URL (reset and seeded in
 * global-setup) with mock providers, so no real job source, AI or e-mail is
 * ever called. They test a production build (`next build` + `next start`):
 * on-demand compilation in `next dev` made runs slow and flaky. The build uses
 * webpack because Turbopack refuses a node_modules that is a symlink/junction
 * outside the project (git worktrees).
 */
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required for e2e tests (see .env.example)");

export const E2E_ADMIN = { email: "e2e-admin@leadpilot.local", password: "e2e-password-not-secret" };
/** Non-admin user for role checks and the change-password test (so the admin's shared session survives). */
export const E2E_OPERATOR = { email: "e2e-operator@leadpilot.local", password: "e2e-operator-not-secret" };
/** Saved signed-in session (gitignored), created by tests/e2e/auth.setup.ts. */
export const ADMIN_STATE = "tests/e2e/.auth/admin.json";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure", navigationTimeout: 90_000 },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: ADMIN_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `npx next build --webpack && npx next start --port ${PORT}`,
    url: `${BASE_URL}/api/health`,
    timeout: 600_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "production",
      // Separate build folder: sharing .next with a Turbopack build or a dev server corrupted
      // webpack's cache (WasmHash crash) in the main checkout.
      NEXT_DIST_DIR: ".next-e2e",
      DATABASE_URL: testDatabaseUrl,
      APP_BASE_URL: BASE_URL,
      // Never call real services from tests, whatever .env says.
      AI_PROVIDER: "mock",
      EMAIL_PROVIDER: "mock",
      JOB_SOURCE_PROVIDER: "mock",
      RUN_EXECUTOR: "inprocess",
      LOG_LEVEL: "warn",
    },
  },
});
