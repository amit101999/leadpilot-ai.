import { test as setup } from "@playwright/test";
import { ADMIN_STATE } from "../../playwright.config";
import { signIn } from "./helpers";

/**
 * Signs in once and saves the session for every other test. Signing in per
 * test would trip the real login rate limit (10 attempts per e-mail per 15 minutes).
 */
setup("sign in as the e2e admin", async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: ADMIN_STATE });
});
