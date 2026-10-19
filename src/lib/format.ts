"use client";

import { useMemo } from "react";
import { useLocale } from "./i18n/provider";
import { makeFormatters, type Formatters } from "./formatters";

export { makeFormatters, type Formatters };

export function useFormat(): Formatters {
  const { intlLocale } = useLocale();
  return useMemo(() => makeFormatters(intlLocale), [intlLocale]);
}
