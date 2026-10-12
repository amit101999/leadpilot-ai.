import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForHydratedForm } from "./helpers";

/** The page header states the current version ("Version N."); toasts mention it too, so scope to the header. */
async function expectVersion(page: Page, n: number) {
  await expect(page.locator("main header").first()).toContainText(`Version ${n}.`);
}

async function createProfile(page: Page, name: string) {
  await page.goto("/profiles/new");
  await waitForHydratedForm(page);
  await page.getByLabel("Profile name").fill(name);
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(page).toHaveURL(/\/profiles\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expectVersion(page, 1);
  await waitForHydratedForm(page);
  return page.url();
}

async function openTab(page: Page, name: string) {
  await page.getByRole("tab", { name }).click();
}

test("creates a profile, edits the budget and shows the change in the version history", async ({ page }) => {
  await openApp(page);
  const url = await createProfile(page, `E2E budget ${randomUUID().slice(0, 6)}`);

  await openTab(page, "Budget & job type");
  await page.getByLabel("Minimum fixed budget").fill("750");
  await page.getByLabel("Change note").fill("Raise minimum budget");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expectVersion(page, 2);

  const history = page.locator("#versions");
  await expect(history.getByText("Raise minimum budget")).toBeVisible();
  await expect(history.getByText("Minimum budget", { exact: true })).toBeVisible();
  await expect(history.getByText("$500", { exact: true })).toBeVisible();
  await expect(history.getByText("$750", { exact: true })).toBeVisible();

  // Restoring version 1 saves it as version 3; nothing is deleted.
  await history.getByRole("button", { name: "Restore this version" }).click();
  await page.getByRole("button", { name: "Restore as a new version" }).click();
  await expectVersion(page, 3);
  await expect(history.getByText("Restored version 1")).toBeVisible();
  expect(page.url()).toBe(url);
});

test("blocks saving while the score weights do not add up to 100", async ({ page }) => {
  await openApp(page);
  const url = await createProfile(page, `E2E weights ${randomUUID().slice(0, 6)}`);
  await openTab(page, "AI scoring");
  await page.getByLabel("Skills (%)").fill("50");
  await expect(page.getByText("Weights add up to 115/100")).toBeVisible();
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(
    page.getByRole("tab", { name: /AI scoring/ }).getByRole("img", { name: "has errors" }),
  ).toBeVisible();

  // Nothing reached the server: the profile is still at version 1.
  const id = url.split("/").pop();
  const response = await page.request.get(`/api/profiles/${id}`);
  expect((await response.json()).data.currentVersion).toBe(1);
});

test("refuses a stale save from a second tab instead of overwriting", async ({ page, context }) => {
  await openApp(page);
  const url = await createProfile(page, `E2E conflict ${randomUUID().slice(0, 6)}`);

  const other = await context.newPage();
  await other.goto(url);
  await waitForHydratedForm(other);
  await other.getByLabel("Profile name").fill("Saved from the other tab");
  await other.getByRole("button", { name: "Save new version" }).click();
  await expectVersion(other, 2);

  await page.getByLabel("Profile name").fill("Stale edit");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByRole("dialog", { name: "This profile was changed by someone else" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();

  const response = await page.request.get(`/api/profiles/${url.split("/").pop()}`);
  const saved = (await response.json()).data;
  expect(saved.name).toBe("Saved from the other tab");
  expect(saved.currentVersion).toBe(2);
});

test("asks before leaving with unsaved changes", async ({ page }) => {
  await openApp(page);
  const url = await createProfile(page, `E2E unsaved ${randomUUID().slice(0, 6)}`);
  await page.getByLabel("Profile name").fill("Edited but not saved");
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  let asked = false;
  page.once("dialog", async (dialog) => {
    asked = dialog.message().includes("unsaved changes");
    await dialog.dismiss(); // stay on the page
  });
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Dashboard" }).click();
  await expect.poll(() => asked).toBe(true);
  expect(page.url()).toBe(url);
});

test("duplicates, archives and restores a profile", async ({ page }) => {
  await openApp(page);
  const name = `E2E lifecycle ${randomUUID().slice(0, 6)}`;
  await createProfile(page, name);

  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByRole("heading", { name: `${name} (copy)` })).toBeVisible();

  await page.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Archive profile" }).click();
  await expect(page.getByText("This profile is archived.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save new version" })).toHaveCount(0);

  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText("This profile is archived.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save new version" })).toBeVisible();
});
