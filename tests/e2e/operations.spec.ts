import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { E2E_OPERATOR } from "../../playwright.config";
import { openApp, signIn, waitForHydrated, waitForHydratedForm } from "./helpers";

const BASE_URL = "http://localhost:3100";

/** A unique e-mail address so reruns never collide (example.com never receives mail). */
function uniqueEmail(): string {
  return `e2e-${randomUUID().slice(0, 8)}@example.com`;
}

/** Creates an opted-in recipient through the API (same-origin request with the shared session). */
async function createOptedInRecipient(page: Page, label: string) {
  const response = await page.request.post("/api/recipients", {
    headers: { origin: BASE_URL },
    data: { label, email: uniqueEmail(), optInConfirmed: true },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data as { id: string };
}

test("recipient opt-in, e-mail alerts on a profile, a run, and the alerts on the Notifications page", async ({
  page,
}) => {
  await openApp(page);
  const label = `E2E inbox ${randomUUID().slice(0, 4)}`;

  // Settings: add a recipient without opt-in, then confirm it with the explicit statement.
  await page.goto("/settings");
  await waitForHydratedForm(page);
  await page.getByRole("button", { name: "Add recipient" }).click();
  // Exact: Settings also has a "Token name" field (import tokens).
  await page.getByLabel("Name", { exact: true }).fill(label);
  await page.getByLabel("E-mail address").fill(uniqueEmail());
  await page.getByRole("button", { name: "Save recipient" }).click();
  const row = page.locator("#recipients li").filter({ hasText: label });
  await expect(row.getByText("Opt-in not confirmed")).toBeVisible();
  await row.getByRole("button", { name: "Confirm opt-in" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Confirm opt-in" })).toBeDisabled();
  await dialog.getByLabel("This person agreed to receive lead alert e-mails from us").check();
  await dialog.getByRole("button", { name: "Confirm opt-in" }).click();
  await expect(row.getByText("Opt-in confirmed")).toBeVisible();

  // A new profile that sends alerts to that recipient.
  await page.goto("/profiles/new");
  await waitForHydratedForm(page);
  await page.getByLabel("Profile name").fill(`E2E alerts ${randomUUID().slice(0, 6)}`);
  await page.getByRole("tab", { name: "Notifications" }).click();
  const recipientSelect = page.getByLabel("E-mail recipient", { exact: true });
  const recipientValue = await recipientSelect.locator("option", { hasText: label }).getAttribute("value");
  await recipientSelect.selectOption(recipientValue!);
  await page.getByLabel("Send e-mail alerts for qualified leads").check();
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(page).toHaveURL(/\/profiles\/[0-9a-f-]{36}$/);
  const profileId = page.url().split("/").pop();

  // Run it and wait for the result.
  await page.goto(`/run?profileId=${profileId}`);
  await page.getByRole("button", { name: "Run agent" }).click();
  await expect(page.getByRole("dialog", { name: "Start a run?" })).toContainText("Up to 10 qualified leads");
  await page.getByRole("dialog").getByRole("button", { name: "Start run" }).click();
  await expect(page.getByText("This run has finished")).toBeVisible({ timeout: 90_000 });

  // The alerts are listed and marked sent (mock provider).
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Notifications" }).click();
  const table = page.getByRole("table", { name: "Alerts" });
  await expect(table.getByText(label).first()).toBeVisible();
  await expect(table.getByText("Sent", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Status").selectOption({ label: "Failed" });
  await expect(page).toHaveURL(
    /status=FAILED_PERMANENT%2CFAILED_RETRYABLE|status=FAILED_PERMANENT,FAILED_RETRYABLE/,
  );
});

/** Starts a run of the profile from the Run Agent page, waits for it to finish and returns its id. */
async function runProfile(page: Page, profileId: string, expectedLimit: number) {
  await page.goto(`/run?profileId=${profileId}`);
  await page.getByRole("button", { name: "Run agent" }).click();
  const dialog = page.getByRole("dialog", { name: "Start a run?" });
  await expect(dialog).toContainText(`Up to ${expectedLimit} qualified leads`);
  await dialog.getByRole("button", { name: "Start run" }).click();
  await expect(page).toHaveURL(/\/run\/[0-9a-f-]{36}$/);
  await expect(page.getByText("This run has finished")).toBeVisible({ timeout: 90_000 });
  return page.url().split("/").pop()!;
}

async function sentAlerts(page: Page, runId: string) {
  const response = await page.request.get(`/api/runs/${runId}/notifications`);
  expect(response.status()).toBe(200);
  const alerts = (await response.json()).data as Array<{ status: string }>;
  return alerts.filter((a) => a.status === "SENT").length;
}

test("the alert limit holds, and a rerun of the same profile sends no repeat alerts", async ({ page }) => {
  await openApp(page);
  const label = `E2E limit ${randomUUID().slice(0, 4)}`;
  await createOptedInRecipient(page, label);

  await page.goto("/profiles/new");
  await waitForHydratedForm(page);
  await page.getByLabel("Profile name").fill(`E2E limit ${randomUUID().slice(0, 6)}`);
  await page.getByRole("tab", { name: "Notifications" }).click();
  const recipientSelect = page.getByLabel("E-mail recipient", { exact: true });
  const recipientValue = await recipientSelect.locator("option", { hasText: label }).getAttribute("value");
  await recipientSelect.selectOption(recipientValue!);
  await page.getByLabel("Send e-mail alerts for qualified leads").check();
  await page.getByLabel("Maximum alerts per run").fill("2");
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(page).toHaveURL(/\/profiles\/[0-9a-f-]{36}$/);
  const profileId = page.url().split("/").pop()!;

  // The mock feed qualifies more than two leads, so the limit decides how many are sent.
  const first = await runProfile(page, profileId, 2);
  expect(await sentAlerts(page, first)).toBe(2);

  // Same profile, same recipient: the next-best leads may be sent, but never one already alerted.
  const second = await runProfile(page, profileId, 2);
  expect(await sentAlerts(page, second)).toBeLessThanOrEqual(2);

  const all = await page.request.get(`/api/notifications?pageSize=100`);
  const rows = (await all.json()).data as Array<{ recipientLabel: string; jobId: string }>;
  const jobIds = rows.filter((r) => r.recipientLabel === label).map((r) => r.jobId);
  expect(jobIds.length).toBeGreaterThanOrEqual(2);
  expect(new Set(jobIds).size).toBe(jobIds.length);
});

test("integrations: test the database connection and send a test e-mail", async ({ page }) => {
  await openApp(page);
  await createOptedInRecipient(page, `E2E test target ${randomUUID().slice(0, 4)}`);
  await page.goto("/integrations");
  await waitForHydrated(page, "#integration-database button");

  const database = page.locator("#integration-database");
  await database.getByRole("button", { name: "Test connection" }).click();
  await expect(database.getByText("Connected")).toBeVisible();

  const upwork = page.locator("#integration-job_source");
  await expect(upwork).toContainText("Live Upwork search is blocked");

  const email = page.locator("#integration-email");
  await email.getByRole("button", { name: "Send test message" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send test message" }).click();
  await expect(page.getByText("Mock provider: the test e-mail was recorded, not sent.")).toBeVisible();
});

test("audit log lists entries and filters them by action", async ({ page }) => {
  await openApp(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audit Logs" }).click();
  const table = page.getByRole("table", { name: "Audit log" });
  await expect(table.getByRole("row")).not.toHaveCount(1);
  await page.getByLabel("Action").selectOption("auth.login");
  await expect(page).toHaveURL(/action=auth\.login/);
  const actions = await table.locator("tbody tr td:nth-child(3)").allTextContents();
  expect(actions.length).toBeGreaterThan(0);
  expect(actions.every((a) => a.trim() === "auth.login")).toBe(true);
});

test.describe("as an operator", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("cannot see or open the audit log", async ({ page }) => {
    await signIn(page, E2E_OPERATOR);
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audit Logs" }),
    ).toHaveCount(0);
    await page.goto("/audit");
    await expect(page.getByText(/could not be found|404/i).first()).toBeVisible();
  });

  test("changes their own password and signs in with the new one", async ({ page }) => {
    const newPassword = `operator-new-${randomUUID().slice(0, 8)}`;
    await signIn(page, E2E_OPERATOR);
    await page.goto("/settings");
    await waitForHydratedForm(page);
    await page.getByLabel("Current password").fill("wrong-current-password");
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Repeat the new password").fill(newPassword);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("The current password is not correct")).toBeVisible();

    await page.getByLabel("Current password").fill(E2E_OPERATOR.password);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Password changed.")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).dispatchEvent("click");
    await expect(page).toHaveURL(/\/login/);
    await signIn(page, { email: E2E_OPERATOR.email, password: newPassword });
  });
});
