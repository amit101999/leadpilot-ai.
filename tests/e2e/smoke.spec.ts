import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "../../playwright.config";
import { openApp, signIn, waitForLoginForm } from "./helpers";

test.describe("signed out", () => {
  // These tests are about signing in and out, so they start without the saved session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("redirects to sign-in and rejects a wrong password", async ({ page }) => {
    await page.goto("/run");
    await expect(page).toHaveURL(/\/login\?next=%2Frun$/);
    await waitForLoginForm(page);
    await page.getByLabel("Email").fill(E2E_ADMIN.email);
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Next.js also renders an (empty) role="alert" route announcer, so match by text.
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    expect(page.url()).not.toContain("password");
  });

  test("never puts credentials in the URL, even if submitted before the page is interactive", async ({
    page,
  }) => {
    await page.goto("/login");
    const method = await page.locator("form").getAttribute("method");
    expect(method).toBe("post");
  });

  test("signs in and out", async ({ page }) => {
    // Its own session, so signing out does not end the session other tests share.
    await signIn(page);
    await page.getByRole("button", { name: "Sign out" }).dispatchEvent("click");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});

test("starts a run and watches it finish (mock providers)", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Demo mode");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Run Agent" }).click();
  await expect(page.getByRole("heading", { name: "Run Agent" })).toBeVisible();
  await expect(page.getByText("Fixed-price only")).toBeVisible();

  await page.getByRole("button", { name: "Run agent" }).click();
  const dialog = page.getByRole("dialog", { name: "Start a run?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Start run" }).click();

  await expect(page).toHaveURL(/\/run\/[0-9a-f-]{36}$/);
  await expect(page.getByText("This run has finished")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Mock source")).toBeVisible();
  const funnel = page.getByRole("list", { name: "Lead funnel" });
  await expect(funnel).toContainText("Discovered");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("list", { name: "Lead funnel" })).toBeVisible();
});

test("search history, run detail, job detail, leads and all jobs (after a run)", async ({ page }) => {
  await openApp(page);
  // A finished run is needed; the previous test may not have run first in isolation.
  await page.goto("/run");
  await page.getByRole("button", { name: "Run agent" }).click();
  await page.getByRole("dialog", { name: "Start a run?" }).getByRole("button", { name: "Start run" }).click();
  await expect(page.getByText("This run has finished")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("link", { name: "See every job and why it passed or failed" }).click();
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]{36}$/);

  await expect(page.getByRole("heading", { name: /^Run / })).toBeVisible();
  await expect(page.getByText("Settings used by this run")).toBeVisible();
  await page.getByRole("button", { name: /^Rejected \d+/ }).click();
  await expect(page).toHaveURL(/tab=rejected/);
  await expect(page.getByText(/below minimum|not verified|excluded by this profile/).first()).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Search History" }).click();
  await expect(page.getByRole("table", { name: "Runs" })).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Qualified Leads" }).click();
  const leads = page.getByRole("table", { name: "Qualified leads" });
  await expect(leads.getByRole("row")).not.toHaveCount(1);
  await leads.locator('a[href^="/jobs/"]').first().click();
  await expect(page.getByText("AI assessment")).toBeVisible();
  await expect(page.getByText("Rule checks")).toBeVisible();

  await page.goto("/leads?decision=any");
  await expect(page.getByLabel("Status")).toHaveValue("any");

  await page.goto("/jobs?status=FILTERED_OUT");
  await expect(
    page.getByRole("table", { name: "All discovered jobs" }).getByText("Filtered out").first(),
  ).toBeVisible();
});

test("list pages have no horizontal page scroll on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/history",
    "/leads",
    "/jobs",
    "/profiles",
    "/notifications",
    "/integrations",
    "/settings",
    "/audit",
  ]) {
    await page.goto(path);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, path).toBeLessThanOrEqual(390);
  }
  await page.goto("/leads");
  await expect(page.getByRole("button", { name: /^Filters/ })).toBeVisible();
});

test("has no horizontal page scroll on a phone and opens the navigation drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});
