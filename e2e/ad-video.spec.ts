import { expect, test, type Page } from "@playwright/test";

// Ad video viewing on the demo deployment: demo video ads play an original generated preview,
// clearly labelled as a demonstration (never an advertiser's real creative).

async function setLanguage(page: Page, lang: string) {
  await page.context().addCookies([{ name: "th_lang", value: lang, url: "http://localhost:3100" }]);
}

const progressOf = async (page: Page) => Number(await page.getByTestId("demo-video-progress").getAttribute("aria-valuenow"));

test.beforeEach(async ({ page }) => {
  await setLanguage(page, "en");
});

test("open a video ad from Ad Spy, play and pause it", async ({ page }) => {
  await page.goto("/app/ads");
  await expect(page.getByTestId("ad-card").first()).toBeVisible();
  await page.getByTestId("watch-ad").first().click();

  const dialog = page.getByTestId("ad-player-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("demo-video-badge")).toHaveText("Generated video preview — demo");
  await expect(dialog.getByTestId("demo-video-disclaimer")).toContainText("not an advertiser's real video");

  const player = dialog.getByTestId("demo-video-preview");
  const toggle = dialog.getByTestId("player-toggle");
  await expect(player).toHaveAttribute("data-state", "playing");
  const start = await progressOf(page);
  await expect.poll(() => progressOf(page)).toBeGreaterThan(start);

  await toggle.click();
  await expect(player).toHaveAttribute("data-state", "paused");
  await expect(toggle).toHaveAttribute("aria-label", "Play preview");
  const paused = await progressOf(page);
  await page.waitForTimeout(600);
  expect(await progressOf(page)).toBe(paused);

  // Keyboard: Space on the focused player toggles playback; arrows change scene.
  await player.focus();
  await page.keyboard.press("Space");
  await expect(player).toHaveAttribute("data-state", "playing");
  await page.keyboard.press("Space");
  await expect(player).toHaveAttribute("data-state", "paused");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("with reduced motion the demo preview starts paused and plays on request", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app/ads");
  await page.getByTestId("watch-ad").first().click();
  const player = page.getByTestId("demo-video-preview");
  await expect(player).toHaveAttribute("data-state", "paused");
  await page.getByTestId("player-toggle").click();
  await expect(player).toHaveAttribute("data-state", "playing");
});

test("the creative viewer shows the player for a video ad", async ({ page }) => {
  await page.goto("/app/ads");
  const card = page.getByTestId("ad-card").filter({ has: page.getByTestId("watch-ad") }).first();
  await card.getByTestId("analyze-ad").click();
  await expect(page.getByTestId("creative-viewer")).toBeVisible();
  await expect(page.getByTestId("creative-player").getByTestId("demo-video-badge")).toBeVisible();
});
