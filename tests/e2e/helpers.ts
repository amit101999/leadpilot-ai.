import { expect, type Page } from "@playwright/test";
import { E2E_ADMIN } from "../../playwright.config";

/** Waits until React has hydrated the login form, so the submit goes through the app's handler. */
export async function waitForLoginForm(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return Boolean(form && Object.keys(form).some((key) => key.startsWith("__react")));
  });
}

export async function signIn(page: Page, user: { email: string; password: string } = E2E_ADMIN) {
  await page.goto("/login");
  await waitForLoginForm(page);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Opens the app with the saved session (see auth.setup.ts); fails if that session is not valid. */
export async function openApp(page: Page) {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Waits until the element matching `selector` has been hydrated by React (clicks would otherwise be lost). */
export async function waitForHydrated(page: Page, selector: string) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return Boolean(el && Object.keys(el).some((k) => k.startsWith("__react")));
  }, selector);
}

/** Waits until a client component's form is interactive (hydrated). */
export async function waitForHydratedForm(page: Page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll("form")].some((form) =>
      Object.keys(form).some((k) => k.startsWith("__react")),
    ),
  );
}
