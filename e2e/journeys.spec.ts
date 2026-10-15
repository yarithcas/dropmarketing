import { expect, test, type Page } from "@playwright/test";

async function setLanguage(page: Page, lang: string) {
  await page.context().addCookies([{ name: "th_lang", value: lang, url: "http://localhost:3100" }]);
}

test.beforeEach(async ({ page }) => {
  await setLanguage(page, "en");
});

test("language switch translates the UI and keeps calculations identical", async ({ page }) => {
  await page.goto("/app/calculator");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Profit Calculator");
  const en = (await page.getByTestId("calc-out-netContribution").innerText()).replace(/[^\d]/g, "");
  await page.getByTestId("language-select").selectOption("de");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rentabilitätsrechner");
  const deNet = await page.getByTestId("calc-out-netContribution").innerText();
  expect(deNet.replace(/[^\d]/g, "")).toBe(en);
});

test("calculator recomputes when assumptions change", async ({ page }) => {
  await page.goto("/app/calculator");
  const out = page.getByTestId("calc-out-breakEvenCpa");
  const before = await out.innerText();
  await page.getByTestId("calc-price").fill("60");
  await expect(out).not.toHaveText(before);
  await expect(page.getByTestId("sensitivity")).toBeVisible();
});

test("product discovery: filter, sort, open detail, analyze", async ({ page }) => {
  await page.goto("/app/products?category=fitness");
  const cards = page.getByTestId("product-card");
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  for (let i = 0; i < count; i++) await expect(cards.nth(i)).toContainText("Fitness");
  await page.getByTestId("products-sort").selectOption("newest");
  await expect(page).toHaveURL(/sort=newest/);
  await cards.first().click();
  await expect(page.getByTestId("score-components")).toBeVisible();
  await page.getByTestId("product-ai").click();
  await expect(page.getByTestId("analyst-result")).toBeVisible();
  await expect(page.getByTestId("analyst-result")).toContainText("Supporting evidence");
});

test("save a product to a new collection, then remove it", async ({ page }) => {
  await page.goto("/app/products/oil-sprayer-glass-mister");
  await page.getByTestId("save-button").first().click();
  await page.getByPlaceholder("New collection name").fill("E2E picks");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("radio").last().check();
  await page.getByTestId("confirm-save").click();
  await expect(page.getByText("Saved to “E2E picks”")).toBeVisible();
  await page.goto("/app/collections");
  await page.getByRole("button", { name: /E2E picks/ }).click();
  await expect(page.getByTestId("collection-item")).toHaveCount(1);
  await page.getByTestId("remove-item").click();
  await expect(page.getByTestId("collection-item")).toHaveCount(0);
});

test("ad spy search and creative analysis", async ({ page }) => {
  await page.goto("/app/ads");
  await page.getByTestId("ads-search").fill("routine");
  await expect(page).toHaveURL(/q=routine/);
  await expect(page.getByTestId("ad-card").first()).toBeVisible();
  await page.getByTestId("analyze-ad").first().click();
  await expect(page.getByTestId("creative-viewer")).toBeVisible();
  await page.getByTestId("run-creative-analysis").click();
  await expect(page.getByTestId("creative-analysis")).toContainText("Original creative variations");
});

test("compare competitor stores", async ({ page }) => {
  await page.goto("/app/stores");
  const boxes = page.getByRole("checkbox");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByTestId("compare-selected").click();
  await expect(page).toHaveURL(/competitors\?ids=/);
  await expect(page.getByTestId("comparison-table")).toContainText("Not estimated");
});

test("alerts: create, pause/resume and run a demo check", async ({ page }) => {
  await page.goto("/app/alerts");
  await page.getByTestId("new-rule").click();
  await page.getByLabel("Rule name").fill("All categories +10%");
  await page.getByLabel("Growth threshold (%)").fill("10");
  await page.getByTestId("save-rule").click();
  const rule = page.getByTestId("alert-rule").filter({ hasText: "All categories +10%" });
  await expect(rule).toBeVisible();
  await rule.getByTestId("toggle-rule").click();
  await expect(rule).toContainText("Paused");
  await rule.getByTestId("toggle-rule").click();
  await expect(rule).toContainText("Active");
  await expect(page.getByTestId("monitoring-status")).toContainText("Not connected");
  // Demo data is labelled as regenerated daily, never as live monitoring.
  await expect(page.getByTestId("refresh-status")).toContainText("Demo data, regenerated every day");
  await page.getByTestId("run-check").click();
  await expect(page.getByText(/Check complete/)).toBeVisible();
  await page.getByRole("tab", { name: /History/ }).click();
  await expect(page.getByText("Demo check").first()).toBeVisible();
});

test("AI analyst answers an example question with records", async ({ page }) => {
  await page.goto("/app/analyst");
  await page.getByTestId("analyst-example").first().click();
  await expect(page.getByTestId("analyst-result")).toBeVisible();
  await expect(page.getByTestId("analyst-result")).toContainText("Rule-based");
});

test("market report renders all sections and exports CSV", async ({ page, request }) => {
  await page.goto("/app/reports/market-fitness");
  await expect(page.getByTestId("report")).toContainText("9. Data sources and collection dates");
  const res = await request.get("/api/reports/market-fitness/csv");
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(await res.text()).toContain("opportunity");
});

test("demo billing: Free plan locks advanced features", async ({ page }) => {
  await page.goto("/app/settings?tab=billing");
  await expect(page.getByTestId("demo-billing")).toBeVisible();
  await page.getByTestId("choose-free").click();
  await expect(page.getByText("Demo plan switched to Free")).toBeVisible();
  await page.goto("/app/calculator");
  await expect(page.getByText("is not included in your plan")).toBeVisible();
  await page.goto("/app/settings?tab=billing");
  await page.getByTestId("choose-pro").click();
  await expect(page.getByText("Demo plan switched to Pro")).toBeVisible();
});

test("integrations report configuration status", async ({ page }) => {
  await page.goto("/app/settings?tab=integrations");
  await expect(page.getByTestId("connector-status").first()).toBeVisible();
  await expect(page.getByTestId("connector-status").filter({ hasText: "Meta Ad Library API" })).toContainText("Not configured");
  await expect(page.getByTestId("service-status").filter({ hasText: "AI provider" })).toContainText("Not configured");
});

test("global search finds products and stores", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("global-search").fill("cat");
  await expect(page.getByText("Interactive Cat Feather Toy").first()).toBeVisible();
  await page.getByTestId("global-search").press("Enter");
  await expect(page).toHaveURL(/\/app\/search\?q=cat/);
});

test("shopify OAuth failures return to the store page with a translated message", async ({ page }) => {
  // Demo deployment: Shopify credentials are absent, so the install route must redirect back, not return JSON.
  await page.goto("/api/integrations/shopify/install?shop=my-store.myshopify.com");
  await expect(page).toHaveURL(/\/app\/stores\?tab=mine&error=not_configured/);
  await expect(page.getByTestId("shopify-oauth-error")).toHaveText("This service is not configured on the server yet.");
  await setLanguage(page, "fr");
  await page.goto("/app/stores?tab=mine&error=invalid_shop");
  await expect(page.getByTestId("shopify-oauth-error")).toContainText("Domaine de boutique invalide");
});

test("page metadata follows the interface language", async ({ page }) => {
  await setLanguage(page, "es");
  await page.goto("/");
  await expect(page).toHaveTitle("TrendHunter — Inteligencia e-commerce");
});
