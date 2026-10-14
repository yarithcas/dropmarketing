"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "./i18n";
import { INTL_LOCALE, LOCALE_COOKIE, type Locale } from "./config";

interface LocaleCtx {
  locale: Locale;
  intlLocale: string;
  setLocale: (l: Locale) => void;
}

const Ctx = createContext<LocaleCtx | null>(null);

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const i18n = useMemo(() => createI18n(initialLocale), [initialLocale]);

  const setLocale = useCallback(
    (l: Locale) => {
      i18n.changeLanguage(l);
      setLocaleState(l);
      document.documentElement.lang = l;
      document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    },
    [i18n],
  );

  const value = useMemo(() => ({ locale, intlLocale: INTL_LOCALE[locale], setLocale }), [locale, setLocale]);
  return (
    <Ctx.Provider value={value}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </Ctx.Provider>
  );
}

export function useLocale(): LocaleCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLocale must be used inside I18nProvider");
  return v;
}
