import type { Formatters } from "./formatters";

/**
 * Presentation params for an alert notification: percentages and counts follow
 * the reader's locale and categories are translated. Stored params stay raw.
 */
export function notificationParams(params: Record<string, string | number>, f: Formatters, category: (key: string) => string) {
  const out: Record<string, string | number> = { ...params };
  if (typeof params.pct === "number") out.pct = f.pct(params.pct, 0, true);
  if (typeof params.n === "number") out.n = f.number(params.n);
  if (typeof params.category === "string") out.category = category(params.category);
  return out;
}
