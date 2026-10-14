"use client";

import { useCallback, useEffect, useState } from "react";

export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

const KEY = "th_currency";
const EVENT = "th-currency-change";

/** Display currency preference (formatting only — no conversion is applied to research prices). */
export function useCurrency(): [CurrencyCode, (c: CurrencyCode) => void] {
  const [cur, setCur] = useState<CurrencyCode>("EUR");
  useEffect(() => {
    const read = () => {
      try {
        const v = localStorage.getItem(KEY) as CurrencyCode | null;
        if (v && (CURRENCIES as readonly string[]).includes(v)) setCur(v);
      } catch {}
    };
    read();
    window.addEventListener(EVENT, read);
    return () => window.removeEventListener(EVENT, read);
  }, []);
  const set = useCallback((c: CurrencyCode) => {
    setCur(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [cur, set];
}
