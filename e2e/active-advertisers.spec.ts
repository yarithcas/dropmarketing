import { expect, test, type Page } from "@playwright/test";

// Active advertisers (≥ 5 ads active for ≥ 7 days) are the default quality bar of every ad list.
// The e2e server pins the demo snapshot (DEMO_SNAPSHOT=2026-10-12, see playwright.config.ts).

const BASE = `http://localhost:${process.env.E2E_PORT ?? 3100}`;

async function setLanguage(page: Page, lang: string) {
  await page.context().addCookies([{ name: "th_lang", value: lang, url: BASE }]);
}

const totalOf = async (page: Page) => Number(await page.getByTestId("ads-result-count").getAttribute("data-total"));

test.beforeEach(async ({ page }) => {
  await setLanguage(page, "en");
});

test("Ad Spy shows only active advertisers by default; the switch reveals the other ads", async ({ page }) => {
  await page.goto("/app/ads");
  const toggle = page.getByTestId("active-advertisers-toggle");
  await expect(toggle).toBeChecked();
  await expect(page.getByText("Active advertisers only — ≥ 5 active ads for ≥ 7 days")).toBeVisible();
  await expect(page.getByTestId("ads-result-count")).toContainText("from active advertisers");
  const cards = page.getByTestId("ad-card");
  await expect(cards.first()).toBeVisible();
  const onTotal = await totalOf(page);
  expect(onTotal).toBeGreaterThan(0);

  // Every card carries the badge, whose tooltip says why the advertiser qualifies.
  const count = await cards.count();
  for (let i = 0; i < count; i++) await expect(cards.nth(i).getByTestId("active-advertiser-badge")).toBeVisible();
  const badge = cards.first().getByTestId("active-advertiser-badge");
  await badge.hover();
  await expect(cards.first().getByRole("tooltip").filter({ hasText: "active ads" })).toContainText(/\d+ active ads running for ≥ 7 days/);

  // The switch is URL-backed: its state follows the URL update.
  await toggle.click();
  await expect(page).toHaveURL(/activeAdvertisers=false/);
  await expect(toggle).not.toBeChecked();
  await expect.poll(() => totalOf(page)).toBeGreaterThan(onTotal);
  await expect(page.getByTestId("ads-result-count")).not.toContainText("from active advertisers");
  await expect(cards.filter({ hasNot: page.getByTestId("active-advertiser-badge") }).first()).toBeVisible();

  // Back on: the default (no parameter) again.
  await toggle.click();
  await expect(page).not.toHaveURL(/activeAdvertisers/);
  await expect(toggle).toBeChecked();
  await expect.poll(() => totalOf(page)).toBe(onTotal);
});

test("when no active advertiser matches, the empty state explains the rule and shows all ads in one click", async ({ page }) => {
  // Pro (default demo plan) can tighten the thresholds; nobody runs 50 ads for 90 days.
  await page.goto("/app/ads?minActiveAds=50&minActiveDays=90");
  await expect(page.getByText("No active advertiser matches")).toBeVisible();
  await expect(page.getByText(/at least 50 active ads currently running for at least 90 days/)).toBeVisible();
  await page.getByTestId("show-all-ads").click();
  await expect(page).toHaveURL(/activeAdvertisers=false/);
  await expect(page.getByTestId("ad-card").first()).toBeVisible();
});

test("product pages default to active advertisers and keep every ad one switch away", async ({ page }) => {
  await page.goto("/app/products/smart-jump-rope-with-counter");
  const box = page.getByTestId("product-related-ads");
  const toggle = box.getByTestId("related-ads-active-toggle");
  await expect(toggle).toBeChecked();
  await expect(box.getByTestId("related-ads-count")).toContainText(/\d+ of 40 ads come from active advertisers/);
  await expect(box.getByTestId("active-advertiser-badge").first()).toBeVisible();

  // A product whose ads all come from smaller advertisers: explained, not silently empty.
  await page.goto("/app/products/heatless-curling-ribbon");
  const other = page.getByTestId("product-related-ads");
  await expect(other.getByTestId("related-ads-count")).toContainText("0 of 52 ads come from active advertisers");
  await other.getByTestId("show-all-ads").click();
  await expect(other.getByTestId("related-ads-active-toggle")).not.toBeChecked();
  await expect(other.locator("li").first()).toBeVisible();
});

test("global search flags active advertisers", async ({ page }) => {
  await page.goto("/app/search?q=corner");
  await expect(page.getByTestId("active-advertiser-flag").first()).toBeVisible();
});

test("store pages default to active advertisers and explain an empty list", async ({ page }) => {
  // Lumen House runs ≥ 5 long-running ads itself; every ad pointing at it qualifies.
  await page.goto("/app/stores/lumen-house");
  const box = page.getByTestId("store-associated-ads");
  await expect(box.getByTestId("store-ads-active-toggle")).toBeChecked();
  await expect(box.getByTestId("store-ads-count")).toContainText(/(\d+) of \1 ads come from active advertisers/);
  await expect(box.getByTestId("active-advertiser-badge").first()).toBeVisible();

  // Trail Studio has many ads but too few long-running active ones.
  await page.goto("/app/stores/trail-studio");
  const other = page.getByTestId("store-associated-ads");
  await expect(other.getByTestId("store-ads-count")).toContainText(/^0 of \d+ ads come from active advertisers/);
  await expect(other.getByText("No active advertiser matches")).toBeVisible();
  await other.getByTestId("show-all-ads").click();
  await expect(other.getByTestId("store-ads-active-toggle")).not.toBeChecked();
  await expect(other.getByTestId("ad-card").first()).toBeVisible();
});

test("creatives lists follow the same default and flag active advertisers", async ({ page }) => {
  await page.goto("/app/creatives");
  await page.getByRole("tab", { name: "Recent" }).click();
  const toggle = page.getByTestId("creatives-active-toggle");
  await expect(toggle).toBeChecked();
  const items = page.getByTestId("creatives-list").locator("li button");
  await expect(items.first()).toBeVisible();
  const n = await items.count();
  for (let i = 0; i < n; i++) await expect(items.nth(i).getByTestId("active-advertiser-flag")).toBeVisible();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(items.filter({ hasNot: page.getByTestId("active-advertiser-flag") }).first()).toBeVisible();
});

test("Free plan: the switch works on every plan, adjusting the thresholds is locked", async ({ page }) => {
  await page.context().addCookies([{ name: "th_demo_plan", value: "free", url: BASE }]);
  // Thresholds passed in the URL are ignored server-side and reported; the default rule applies.
  await page.goto("/app/ads?minActiveAds=1&minActiveDays=0");
  await expect(page.getByTestId("ads-filters-ignored")).toBeVisible();
  await expect(page.getByText("Active advertisers only — ≥ 5 active ads for ≥ 7 days")).toBeVisible();
  await expect(page.getByTestId("min-active-ads")).toBeDisabled();
  await expect(page.getByTestId("min-active-days")).toBeDisabled();
  const onTotal = await totalOf(page);
  const toggle = page.getByTestId("active-advertisers-toggle");
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(page).toHaveURL(/activeAdvertisers=false/);
  await expect.poll(() => totalOf(page)).toBeGreaterThan(onTotal);
});
