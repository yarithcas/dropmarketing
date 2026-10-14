import { chromium } from "@playwright/test";
const base = "http://localhost:3100";
const shots = process.argv[2];
const routes = ["/", "/pricing", "/login", "/signup", "/privacy", "/terms", "/app", "/app/products", "/app/products/smart-jump-rope-with-counter", "/app/products/focus-timer-cube", "/app/ads", "/app/creatives?ad=ad-smart-jump-rope-with-counter-3", "/app/trends", "/app/competitors?ids=lumen-market,habitat-house", "/app/stores", "/app/stores?tab=mine", "/app/collections", "/app/analyst", "/app/reports", "/app/reports/market-fitness", "/app/reports/competitive-landscape", "/app/alerts", "/app/alerts?tab=watchlist", "/app/settings", "/app/settings?tab=billing", "/app/settings?tab=integrations", "/app/settings?tab=privacy", "/app/calculator", "/app/search?q=pet", "/nope"];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(`[console] ${page.url()} ${m.text().slice(0, 300)}`); });
page.on("pageerror", (e) => problems.push(`[pageerror] ${page.url()} ${e.message.slice(0, 300)}`));
for (const r of routes) {
  const res = await page.goto(base + r, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const missing = await page.evaluate(() => (document.body.innerText.match(/\b[a-z]+\.[a-zA-Z_]+\.[a-zA-Z_.]+\b/g) || []).filter((s) => !s.includes("myshopify") && !s.includes(".example") && !/\.(com|app|js|json)$/.test(s)).slice(0, 5));
  if (missing.length) problems.push(`[raw-key?] ${r} ${missing.join(" ")}`);
  console.log(res?.status(), r);
  const name = r.replace(/[^a-z0-9]+/gi, "_").slice(0, 60) || "home";
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}
console.log(problems.join("\n") || "NO PROBLEMS");
await browser.close();
