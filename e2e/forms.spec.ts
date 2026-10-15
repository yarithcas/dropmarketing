import { expect, test, type Page } from "@playwright/test";

// Forms not covered by the journeys: demo sign-in, profile, data export, account
// deletion and collection management. The suite runs against the demo deployment.

async function setLanguage(page: Page, lang: string) {
  await page.context().addCookies([{ name: "th_lang", value: lang, url: "http://localhost:3100" }]);
}

test.beforeEach(async ({ page }) => {
  await setLanguage(page, "en");
});

test("demo sign-in personalises the session and the profile form saves", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Name").fill("Ada Test");
  await page.getByTestId("auth-email").fill("ada@example.com");
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/settings");
  // Role locators ignore the hidden copy React keeps while streaming the page.
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toHaveValue("Ada Test");
  await name.fill("Ada Lovelace");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue("Ada Lovelace");
});

test("privacy: export downloads the workspace and deletion requires the confirmation word", async ({ page }) => {
  await page.goto("/app/settings?tab=privacy");
  const download = page.waitForEvent("download");
  await page.getByTestId("export-data").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("trendhunter-demo-export.json");

  const del = page.getByTestId("delete-account");
  await expect(del).toBeDisabled();
  await page.locator("#confirm-del").fill("delete");
  await expect(del).toBeDisabled();
  await page.locator("#confirm-del").fill("DELETE");
  await del.click();
  await expect(page).toHaveURL(/\/$/);
});

test("collections: create, rename and delete", async ({ page }) => {
  await page.goto("/app/collections");
  await page.getByTestId("new-collection").click();
  await page.locator("#col-name").fill("E2E rename me");
  await page.getByTestId("create-collection").click();
  await expect(page.getByText("Collection created")).toBeVisible();
  const created = page.getByRole("button", { name: /E2E rename me/ });
  await created.click();
  await expect(created).toHaveAttribute("aria-current", "true");

  await page.getByRole("button", { name: "Edit collection" }).click();
  await page.locator("#col-name").fill("E2E renamed");
  await page.getByTestId("create-collection").click();
  await expect(page.getByRole("button", { name: /E2E renamed/ })).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete collection" }).click();
  await expect(page.getByText("Collection deleted")).toBeVisible();
  await expect(page.getByRole("button", { name: /E2E renamed/ })).toHaveCount(0);
});

test("collections: a selection applies at once, even while the URL round trip is slow", async ({ page }) => {
  await page.goto("/app/collections");
  // Delay router round trips: Edit must still target the collection that was just clicked.
  await page.route(/_rsc=/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue().catch(() => {});
  });
  await page.getByTestId("new-collection").click();
  await page.locator("#col-name").fill("E2E slow select");
  await page.getByTestId("create-collection").click();
  await expect(page.getByText("Collection created")).toBeVisible();
  await page.getByRole("button", { name: /E2E slow select/ }).click();
  await page.getByRole("button", { name: "Edit collection" }).click();
  await expect(page.locator("#col-name")).toHaveValue("E2E slow select");
});

test("free plan locks advanced ad filters and watchlists", async ({ page }) => {
  await page.goto("/app/settings?tab=billing");
  await page.getByTestId("choose-free").click();
  await expect(page.getByText("Demo plan switched to Free")).toBeVisible();

  // An advanced filter passed in the URL is ignored server-side and reported.
  await page.goto("/app/ads?country=FR");
  await expect(page.getByTestId("ads-filters-ignored")).toBeVisible();

  await page.goto("/app/products/oil-sprayer-glass-mister");
  await expect(page.getByTestId("watch-locked")).toBeVisible();

  await page.goto("/app/settings?tab=billing");
  await page.getByTestId("choose-pro").click();
  await expect(page.getByText("Demo plan switched to Pro")).toBeVisible();
});
