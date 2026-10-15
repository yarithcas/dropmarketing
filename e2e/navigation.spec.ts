import { expect, test } from "@playwright/test";

const SIDEBAR = [
  ["/app", "Vue d'ensemble"],
  ["/app/products", "Produits gagnants"],
  ["/app/ads", "Ad Spy"],
  ["/app/creatives", "Analyseur de créatives"],
  ["/app/trends", "Produits tendance"],
  ["/app/competitors", "Analyse concurrentielle"],
  ["/app/stores", "Intelligence boutiques Shopify"],
  ["/app/collections", "Collections de produits"],
  ["/app/analyst", "Analyste produit IA"],
  ["/app/reports", "Rapports de marché"],
  ["/app/alerts", "Alertes et listes de suivi"],
  ["/app/settings", "Paramètres et abonnement"],
  ["/app/calculator", "Calculateur de rentabilité"],
] as const;

test("landing page leads to the demo (French by default)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Trouvez votre prochain produit gagnant");
  await page.getByTestId("cta-demo").click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("demo-banner")).toBeVisible();
  await expect(page.getByTestId("demo-banner")).toContainText("Données de démonstration, régénérées chaque jour");
});

test("every app route renders its heading without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [path, heading] of SIDEBAR) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { level: 1 }).first(), path).toContainText(heading);
  }
  for (const path of ["/pricing", "/login", "/signup", "/privacy", "/terms"]) {
    expect((await page.goto(path))?.status(), path).toBe(200);
  }
  expect(errors).toEqual([]);
});
