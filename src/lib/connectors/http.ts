import "server-only";

const UA = "TrendHunterBot/1.0 (+https://trendhunter.app/bot; respects robots.txt)";
const last = new Map<string, number>();

/** One request per second per host, identified user agent, 10s timeout. */
export async function politeFetch(url: string): Promise<Response | null> {
  const host = new URL(url).host;
  const wait = (last.get(host) ?? 0) + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last.set(host, Date.now());
  try {
    return await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(10_000), redirect: "follow" });
  } catch {
    return null;
  }
}

/** Minimal robots.txt check for our user agent (and *). Missing robots.txt = allowed. */
export async function robotsAllows(domain: string, path: string): Promise<boolean> {
  const res = await politeFetch(`https://${domain}/robots.txt`);
  if (!res || res.status === 404) return true;
  if (!res.ok) return false;
  const txt = await res.text();
  let applies = false;
  const disallow: string[] = [];
  for (const raw of txt.split("\n")) {
    const line = raw.split("#")[0].trim();
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k)) applies = v === "*" || /trendhunter/i.test(v);
    else if (applies && /^disallow$/i.test(k) && v) disallow.push(v);
  }
  return !disallow.some((d) => path.startsWith(d));
}
