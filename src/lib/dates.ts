/** Date helpers operating on ISO `YYYY-MM-DD` strings in UTC (timezone-safe). */

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseDay(day: string): Date {
  return new Date(`${day.slice(0, 10)}T00:00:00Z`);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}

export const RANGE_DAYS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 } as const;
