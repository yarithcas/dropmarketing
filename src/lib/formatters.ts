import { parseDay } from "./dates";

/** Locale-aware formatters. They only change presentation, never the underlying values. */
export function makeFormatters(intlLocale: string) {
  const cache = new Map<string, Intl.NumberFormat>();
  const nf = (key: string, opts: Intl.NumberFormatOptions) => {
    if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(intlLocale, opts));
    return cache.get(key)!;
  };
  return {
    /** `currency` null = not known: the amount is shown without a currency rather than with a guessed one. */
    currency(n: number | null | undefined, currency: string | null = "EUR", dp = 2) {
      if (n == null || !Number.isFinite(n)) return "—";
      if (currency == null) return nf(`n-${dp}`, { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
      return nf(`c-${currency}-${dp}`, { style: "currency", currency, minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
    },
    number(n: number | null | undefined, dp = 0) {
      if (n == null || !Number.isFinite(n)) return "—";
      return nf(`n-${dp}`, { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
    },
    compact(n: number | null | undefined) {
      if (n == null || !Number.isFinite(n)) return "—";
      return nf("compact", { notation: "compact", maximumFractionDigits: 1 }).format(n);
    },
    /** `n` is already a percentage (e.g. 12.5 => 12.5 %). */
    pct(n: number | null | undefined, dp = 0, signed = false) {
      if (n == null || !Number.isFinite(n)) return "—";
      return nf(`p-${dp}-${signed}`, { style: "percent", minimumFractionDigits: dp, maximumFractionDigits: dp, signDisplay: signed ? "exceptZero" : "auto" }).format(n / 100);
    },
    date(day: string | null | undefined, style: "short" | "medium" | "long" = "medium") {
      if (!day) return "—";
      const d = day.length === 10 ? parseDay(day) : new Date(day);
      const opts: Intl.DateTimeFormatOptions =
        style === "short" ? { day: "2-digit", month: "short" } : style === "long" ? { dateStyle: "long", timeZone: "UTC" } : { dateStyle: "medium", timeZone: "UTC" };
      if (style === "short") opts.timeZone = "UTC";
      return new Intl.DateTimeFormat(intlLocale, opts).format(d);
    },
    dateTime(iso: string | null | undefined) {
      if (!iso) return "—";
      return new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
    },
  };
}

export type Formatters = ReturnType<typeof makeFormatters>;
