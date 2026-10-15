// UI interactivity audit: visits every route in a real browser, enumerates every clickable element and
// records interactivity problems (dead clicks, missing hover/focus/active styles, unexplained disabled
// controls, icon-only buttons without a name, slow feedback on async actions, cards that look clickable
// but are not, small touch targets on mobile).
//
//   npx next build && npx next start -p 3203 &
//   PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/ui-audit.mjs [--base http://localhost:3203] [--out audit.json] [--no-click] [--only /app/ads]
//
// Prints a summary per finding type and writes the full list as JSON. Exit code is always 0 (it is a report).
import fs from "node:fs";
import { chromium, devices } from "@playwright/test";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const BASE = arg("--base", process.env.AUDIT_URL ?? "http://localhost:3203");
const OUT = arg("--out", null);
const CLICK = !process.argv.includes("--no-click");
const ONLY = arg("--only", null);
const SAMPLES_PER_SIGNATURE = 2;

const STATIC_ROUTES = [
  "/",
  "/pricing",
  "/login",
  "/signup",
  "/app",
  "/app/products",
  "/app/products/oil-sprayer-glass-mister",
  "/app/ads",
  "/app/creatives",
  "/app/creatives?ad=ad-smart-jump-rope-with-counter-3",
  "/app/trends",
  "/app/stores",
  "/app/stores?tab=mine",
  "@store", // resolved at runtime: first store detail link on /app/stores
  "/app/competitors",
  "/app/analyst",
  "/app/calculator",
  "/app/collections",
  "/app/alerts",
  "/app/alerts?tab=watchlist",
  "/app/reports",
  "/app/reports/market-fitness",
  "/app/search?q=pet",
  "/app/settings?tab=profile",
  "/app/settings?tab=billing",
  "/app/settings?tab=integrations",
  "/app/settings?tab=team",
  "/app/settings?tab=privacy",
];

// Never click these (they would sign out, delete data or leave the site for good).
const DANGEROUS = /(sign ?out|log ?out|déconnexion|delete|supprimer|remove|retirer|cancel subscription|revoke|leave workspace|reset|stripe|portal)/i;

const NO_ANIM = `*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}`;

/** Runs in the page: tags candidates with data-audit-id and returns static findings + click candidates. */
function collect({ mobile, SAMPLES }) {
  const SEL = 'button, a[href], [role=button], [role=tab], [role=checkbox], [role=switch], [role=menuitem], summary, [data-card-href], [data-testid$="-card"], .card';
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
  };
  const isInteractive = (el) => el.matches('button, a[href], [role=button], [role=tab], [role=checkbox], [role=switch], [role=menuitem], summary, input, select, textarea, label');

  // --- CSSOM: which elements have :hover / :focus(-visible) / :active rules
  const pseudoSelectors = { hover: [], focus: [], active: [] };
  // split a selector list on top-level commas only (":where(a, b:not(c))" stays whole)
  const splitSelector = (sel) => {
    const out = [];
    let depth = 0;
    let cur = "";
    for (const ch of sel) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.selectorText) {
        if (rule.media && !window.matchMedia(rule.media.mediaText).matches && !/hover/.test(rule.media.mediaText)) continue;
        walk(rule.cssRules);
        continue;
      }
      const sel = rule.selectorText;
      if (!sel) continue;
      for (const part of splitSelector(sel)) {
        for (const [k, re] of [["hover", /:hover/], ["focus", /:focus-visible|:focus(?!-within)/], ["active", /:active/]]) {
          if (re.test(part)) {
            const stripped = part
              .replace(/:hover|:focus-visible|:focus-within|:focus|:active/g, "")
              .replace(/::?(before|after|placeholder|selection|marker)/g, "")
              .replace(/:not\(:disabled\)|:not\(\[aria-disabled="?true"?\]\)|:enabled/g, "")
              .trim();
            if (stripped) pseudoSelectors[k].push(stripped);
          }
        }
      }
    }
  };
  for (const ss of document.styleSheets) {
    try {
      walk(ss.cssRules);
    } catch {
      /* cross-origin */
    }
  }
  const matchesAny = (el, list, self = false) => {
    const targets = self ? [el] : [el, ...el.querySelectorAll("*")].slice(0, 40);
    for (const s of list) {
      try {
        if (targets.some((t) => t.matches(s))) return true;
      } catch {
        /* invalid after stripping */
      }
    }
    return false;
  };
  const hasPseudo = (el, k, self = false) => matchesAny(el, pseudoSelectors[k], self);
  // The current choice of a tab set / toggle group / nav: clicking it again rightly does nothing.
  const isCurrent = (el) => el.matches('[aria-selected=true], [aria-pressed=true], [aria-current]:not([aria-current=false]), [aria-checked=true][role=radio]');

  const accName = (el) => {
    const lbl = el.getAttribute("aria-label") || el.getAttribute("title");
    if (lbl && lbl.trim()) return lbl.trim();
    const by = el.getAttribute("aria-labelledby");
    if (by) return by.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
    const imgAlt = [...el.querySelectorAll("img[alt],[role=img][aria-label]")].map((i) => i.getAttribute("alt") || i.getAttribute("aria-label")).join(" ");
    return (el.innerText || el.textContent || "").trim() || imgAlt.trim();
  };
  const describe = (el) => {
    const t = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 50);
    const tid = el.getAttribute("data-testid");
    return `${el.tagName.toLowerCase()}${tid ? `[${tid}]` : ""}${el.getAttribute("role") ? `(${el.getAttribute("role")})` : ""} "${t}"`;
  };

  const findings = [];
  const candidates = [];
  const els = [...document.querySelectorAll(SEL)].filter(visible);
  els.forEach((el, i) => el.setAttribute("data-audit-id", String(i)));
  const sigCount = {};
  for (const el of els) {
    const id = el.getAttribute("data-audit-id");
    const d = describe(el);
    if (el.matches("[data-card-href]")) {
      // clickable card / row: check it actually navigates (sampled like other controls)
      const sig = `card|${el.tagName}|${el.getAttribute("data-testid") ?? ""}`;
      sigCount[sig] = (sigCount[sig] ?? 0) + 1;
      if (sigCount[sig] <= SAMPLES) candidates.push({ id, d, href: el.getAttribute("data-card-href"), external: false, card: true });
      continue;
    }
    const isCard = el.matches('.card, [data-testid$="-card"]') && !el.matches("a, button");
    const cs = getComputedStyle(el);
    if (isCard) {
      // A card "looks clickable" if it has hover styles or a pointer cursor but is not itself interactive.
      const looksClickable = hasPseudo(el, "hover", true) || cs.cursor === "pointer";
      const tid = el.getAttribute("data-testid") || "";
      const entity = /^(product|ad|store|report|collection|trend)-card$/.test(tid);
      if (looksClickable || entity) {
        const r = el.getBoundingClientRect();
        // probe a few non-interactive points: does a click land on a link/button (stretched link)?
        const pts = [
          [r.left + r.width * 0.5, r.top + r.height * 0.55],
          [r.left + r.width * 0.3, r.top + r.height * 0.7],
          [r.left + 12, r.top + r.height - 12],
        ];
        let hit = 0;
        for (const [x, y] of pts) {
          if (y < 0 || y > innerHeight) {
            hit++; // off-screen: do not penalise
            continue;
          }
          const at = document.elementFromPoint(x, y);
          if (at && el.contains(at) && (at.closest("a[href],button,[role=button],label,input,select,textarea") || at.closest("[data-card-href]"))) hit++;
          else if (at && !el.contains(at)) hit++;
        }
        if (hit < pts.length) findings.push({ type: "card-not-clickable", el: d, detail: entity ? "entity card is only partially clickable" : "has hover/pointer styling but is not interactive" });
      }
      continue;
    }
    const disabled = el.matches(":disabled, [aria-disabled=true]");
    if (disabled) {
      const explained =
        el.getAttribute("title") ||
        el.getAttribute("aria-describedby") ||
        el.closest("[title]") ||
        el.closest(".group\\/tt") ||
        el.getAttribute("data-disabled-reason");
      if (!explained) findings.push({ type: "disabled-unexplained", el: d });
    }
    // icon-only: no visible text
    const text = (el.innerText || "").trim();
    if (!text && el.matches("button, a[href], [role=button], [role=tab]") && !accName(el)) findings.push({ type: "icon-no-label", el: d, detail: el.outerHTML.slice(0, 120) });
    if (!text && el.matches("button, [role=button]") && accName(el) && !el.getAttribute("title") && !el.closest(".group\\/tt")) findings.push({ type: "icon-no-tooltip", el: d });
    if (!disabled) {
      const inlineText = cs.display === "inline" && el.matches("a") && el.parentElement && /\S/.test(el.parentElement.textContent.replace(el.textContent, ""));
      if (!hasPseudo(el, "hover") && !inlineText && !isCurrent(el)) findings.push({ type: "no-hover-style", el: d });
      if (!hasPseudo(el, "focus")) findings.push({ type: "no-focus-style", el: d });
      if (el.matches("button, [role=button], [role=tab]") && !hasPseudo(el, "active")) findings.push({ type: "no-active-style", el: d });
      if (el.matches("button, [role=button]") && cs.cursor !== "pointer") findings.push({ type: "no-pointer-cursor", el: d });
    } else if (cs.cursor !== "not-allowed") {
      findings.push({ type: "disabled-no-cursor", el: d });
    }
    if (mobile && !disabled) {
      const r = el.getBoundingClientRect();
      const inline = cs.display === "inline";
      if (!inline && (r.height < 40 || r.width < 40) && !el.closest("[data-audit-ignore-target]")) {
        // effective target: allow an ::after hit-area extension
        // effective target: an absolutely positioned ::after may extend the hit area beyond the box
        const after = getComputedStyle(el, "::after");
        let w = r.width;
        let h = r.height;
        // overflow clipping also clips the pseudo-element's hit area: it only counts on visible-overflow boxes
        if (after.content !== "none" && after.position === "absolute" && cs.position !== "static" && cs.overflowX === "visible" && cs.overflowY === "visible") {
          const px = (v) => (v.endsWith("px") ? parseFloat(v) : 0);
          h = Math.max(h, h - Math.min(0, px(after.top)) - Math.min(0, px(after.bottom)));
          w = Math.max(w, w - Math.min(0, px(after.left)) - Math.min(0, px(after.right)));
        }
        if (h < 39.5 || w < 39.5) findings.push({ type: "small-touch-target", el: d, detail: `${Math.round(r.width)}x${Math.round(r.height)}` });
      }
    }
    if (!disabled && isInteractive(el)) {
      const href = el.getAttribute("href") || "";
      if (/^(mailto:|tel:)/.test(href)) continue;
      const sig = `${el.tagName}|${el.getAttribute("role") ?? ""}|${el.getAttribute("data-testid") ?? ""}|${el.className}`;
      sigCount[sig] = (sigCount[sig] ?? 0) + 1;
      // info "i" buttons only reveal their tooltip on hover/focus/tap: no DOM change is expected
      const tooltipTrigger = el.hasAttribute("data-tooltip-trigger");
      if (sigCount[sig] <= SAMPLES && !isCurrent(el) && !tooltipTrigger) candidates.push({ id, d, href, external: el.getAttribute("target") === "_blank" });
    }
  }
  return { findings, candidates };
}

/** Runs in the page: arms observers before a click. */
function arm() {
  window.__audit = { mutations: [], start: performance.now(), url: location.href, scroll: scrollY, active: document.activeElement, form: [...document.querySelectorAll("input,select,textarea")].map((i) => `${i.checked}|${i.value}`).join(",") };
  const mo = new MutationObserver((ms) => {
    for (const m of ms) {
      // ignore our own marker attributes
      if (m.type === "attributes" && m.attributeName === "data-audit-id") continue;
      window.__audit.mutations.push(performance.now() - window.__audit.start);
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  window.__auditMo = mo;
}
function readEffect() {
  const a = window.__audit;
  if (!a) return { navigated: true };
  window.__auditMo?.disconnect();
  const form = [...document.querySelectorAll("input,select,textarea")].map((i) => `${i.checked}|${i.value}`).join(",");
  return {
    navigated: location.href !== a.url,
    first: a.mutations.length ? Math.min(...a.mutations) : null,
    count: a.mutations.length,
    scrolled: scrollY !== a.scroll,
    focusMoved: document.activeElement !== a.active && document.activeElement !== document.body && !document.activeElement?.hasAttribute("data-audit-id"),
    formChanged: form !== a.form,
    toast: !!document.querySelector("[aria-live] > *"),
  };
}

async function resolveStore(page) {
  await page.goto(BASE + "/app/stores", { waitUntil: "networkidle" });
  const href = await page.locator('a[href^="/app/stores/"]').first().getAttribute("href");
  return href ?? "/app/stores";
}

async function auditRoute(ctx, route, { mobile }) {
  const page = await ctx.newPage();
  const findings = [];
  const load = async () => {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: NO_ANIM });
    await page.waitForTimeout(150);
    return page.evaluate(collect, { mobile, SAMPLES: SAMPLES_PER_SIGNATURE });
  };
  let res;
  try {
    res = await load();
  } catch (e) {
    findings.push({ type: "route-error", el: route, detail: String(e).slice(0, 200) });
    await page.close();
    return findings;
  }
  findings.push(...res.findings);
  if (CLICK && !mobile) {
    let dirty = false;
    for (const c of res.candidates) {
      if (DANGEROUS.test(c.d)) continue;
      if (dirty) {
        try {
          await load();
        } catch {
          break;
        }
        dirty = false;
      }
      const loc = page.locator(`[data-audit-id="${c.id}"]`);
      if (!(await loc.count())) continue;
      if (c.external) {
        // external link: it must open a new tab; we don't follow it
        continue;
      }
      try {
        await page.evaluate(arm);
        const popup = page.context().waitForEvent("page", { timeout: 1200 }).catch(() => null);
        const download = page.waitForEvent("download", { timeout: 1200 }).catch(() => null);
        await loc.click({ timeout: 2000, noWaitAfter: true });
        await page.waitForTimeout(250);
        let eff = await page.evaluate(readEffect).catch(() => ({ navigated: true }));
        let late = false;
        if (!eff.navigated && !eff.count && !eff.scrolled && !eff.focusMoved && !eff.formChanged) {
          // give async work a chance: anything after this point is "feedback too late"
          await page.evaluate(arm);
          await page.waitForTimeout(1500);
          const e2 = await page.evaluate(readEffect).catch(() => ({ navigated: true }));
          const [pp, dl] = await Promise.all([popup, download]);
          if (pp) await pp.close();
          if (e2.navigated || e2.count || e2.formChanged) late = true;
          else if (!pp && !dl) findings.push({ type: "dead-click", el: c.d });
          eff = e2;
        }
        if (late) findings.push({ type: "slow-feedback", el: c.d, detail: "no visible response within 250ms (missing loading state)" });
        if (eff.navigated || eff.count || eff.formChanged || eff.scrolled) dirty = true;
        if (page.url() !== BASE + route) dirty = true;
      } catch (e) {
        findings.push({ type: "click-error", el: c.d, detail: String(e).split("\n")[0].slice(0, 160) });
        dirty = true;
      }
    }
  }
  await page.close();
  return findings.map((f) => ({ route, viewport: mobile ? "mobile" : "desktop", ...f }));
}

const CONCURRENCY = Number(arg("--concurrency", 6));
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
const newCtx = async (mobile) => {
  const ctx = await browser.newContext(mobile ? { ...devices["Pixel 7"] } : { viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: "th_lang", value: "en", url: BASE }]);
  return ctx;
};
const probe = await newCtx(false);
const storeRoute = await resolveStore(await probe.newPage());
await probe.close();
const tasks = [];
for (const mobile of [false, true])
  for (const r0 of STATIC_ROUTES) {
    const r = r0 === "@store" ? storeRoute : r0;
    if (!ONLY || r === ONLY) tasks.push({ r, mobile });
  }
const results = new Array(tasks.length);
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < tasks.length) {
      const i = next++;
      const { r, mobile } = tasks[i];
      // fresh context per route: clicks on one route never leak workspace state into another
      const ctx = await newCtx(mobile);
      const f = await auditRoute(ctx, r, { mobile });
      await ctx.close();
      const seen = new Set();
      results[i] = f.filter((x) => {
        const k = `${x.type}|${x.el}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      process.stderr.write(`${mobile ? "mobile " : "desktop"} ${r}: ${results[i].length}\n`);
    }
  }),
);
await browser.close();
const all = results.flat();

const byType = {};
for (const f of all) byType[f.type] = (byType[f.type] ?? 0) + 1;
console.log("\n=== UI audit summary ===");
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) console.log(`${k.padEnd(22)} ${v}`);
console.log(`${"TOTAL".padEnd(22)} ${all.length}`);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ byType, findings: all }, null, 2));
else for (const f of all) console.log(`[${f.type}] ${f.viewport} ${f.route} ${f.el}${f.detail ? ` — ${f.detail}` : ""}`);
