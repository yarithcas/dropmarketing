// Lists translation keys referenced in src (literal t("...") calls, { key: "..." } signals, and template prefixes).
import fs from "node:fs";
import path from "node:path";
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|ts)$/.test(f)) files.push(p); } };
walk("src");
const keys = new Set(); const templates = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  for (const m of s.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) keys.add(m[1]);
  for (const m of s.matchAll(/\bt\(\s*`([^`]+)`/g)) templates.add(m[1]);
  for (const m of s.matchAll(/key: "([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)"/g)) keys.add(m[1]);
  for (const m of s.matchAll(/"((?:analyst|creative|reports|steps|signals|insufficient|connectors|alerts)\.[a-zA-Z0-9_.]+)"/g)) keys.add(m[1]);
}
console.log(JSON.stringify({ keys: [...keys].sort(), templates: [...templates].sort() }, null, 1));
