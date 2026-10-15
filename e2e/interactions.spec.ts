import { expect, test, type Page, type Route } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "th_lang", value: "en", url: "http://localhost:3100" }]);
});

/** Holds an API response long enough for the loading state to be observable. */
async function slow(page: Page, pattern: string, ms = 900) {
  await page.route(pattern, async (route: Route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

test("clicking anywhere on an ad card opens the creative viewer, nested actions keep their own behaviour", async ({ page }) => {
  await page.goto("/app/ads");
  const card = page.getByTestId("ad-card").first();
  await expect(card).toBeVisible();
  // The save action inside the card opens its dialog instead of navigating.
  await card.getByTestId("save-button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/app\/ads/);
  // A tooltip badge (provenance explanation) reveals its tooltip instead of opening the card.
  await card.getByText("Demo data", { exact: true }).click();
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/app\/ads$/);
  // A click on plain card content navigates.
  await card.locator("dl").click();
  await expect(page).toHaveURL(/\/app\/creatives\?ad=/);
  await expect(page.getByTestId("creative-viewer")).toBeVisible();
});

test("product cards are links and store rows open the store", async ({ page }) => {
  await page.goto("/app/products");
  const card = page.getByTestId("product-card").first();
  await expect(card).toHaveAttribute("href", /\/app\/products\//);
  await card.click();
  await expect(page.getByTestId("score-components")).toBeVisible();

  await page.goto("/app/stores");
  const row = page.getByTestId("store-row").first();
  await row.locator("td").nth(2).click();
  await expect(page).toHaveURL(/\/app\/stores\/[^?]+$/);
});

test("ticking a store checkbox selects it without opening the row", async ({ page }) => {
  await page.goto("/app/stores");
  const compare = page.getByTestId("compare-selected");
  await expect(compare).toBeDisabled();
  await expect(compare).toHaveAttribute("title", /at least 2/);
  await page.getByRole("checkbox").first().check();
  await expect(page).toHaveURL(/\/app\/stores$/);
  // A click in the checkbox cell but outside the label also toggles and never opens the row.
  const row = page.getByTestId("store-row").nth(1);
  await row.locator("td").first().click({ position: { x: 2, y: 2 } });
  await expect(row.getByRole("checkbox")).toBeChecked();
  await expect(compare).toBeEnabled();
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/app\/stores$/);
});

test("alert check shows a loading state, then a toast", async ({ page }) => {
  await slow(page, "**/api/alerts/evaluate");
  await page.goto("/app/alerts");
  const run = page.getByTestId("run-check");
  await run.click();
  await expect(run).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("toast").first()).toBeVisible();
  await expect(run).not.toHaveAttribute("aria-busy", "true");
});

test("AI product analysis shows a loading state, then the result and a toast", async ({ page }) => {
  await slow(page, "**/api/ai/analyst");
  await page.goto("/app/products/oil-sprayer-glass-mister");
  const btn = page.getByTestId("product-ai");
  await btn.click();
  await expect(btn).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("analyst-result")).toBeVisible();
  await expect(page.getByTestId("toast").filter({ hasText: "Analysis ready" })).toBeVisible();
  await expect(btn).not.toHaveAttribute("aria-busy", "true");
});

test("icon-only buttons have an accessible name and a tooltip", async ({ page }) => {
  await page.goto("/app/products");
  for (const name of ["Grid view", "Table view", "Notifications"]) {
    const b = page.getByRole("button", { name, exact: true });
    await expect(b).toHaveAttribute("title", name);
  }
});
