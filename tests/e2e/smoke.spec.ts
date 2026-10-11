import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "../../playwright.config";

/** Waits until React has hydrated the login form, so the submit goes through the app's handler. */
async function waitForLoginForm(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return Boolean(form && Object.keys(form).some((key) => key.startsWith("__react")));
  });
}

async function signIn(page: Page) {
  await page.goto("/login");
  await waitForLoginForm(page);
  await page.getByLabel("Email").fill(E2E_ADMIN.email);
  await page.getByLabel("Password").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

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

test("signs in, starts a run and watches it finish (mock providers)", async ({ page }) => {
  await signIn(page);
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

test("has no horizontal page scroll on a phone and opens the navigation drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});

test("signs out", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Sign out" }).dispatchEvent("click");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
