import "server-only";
import { DEFAULT_LOCALE, type Locale } from "../i18n/config";
import fr from "@/locales/fr.json";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import de from "@/locales/de.json";
import it from "@/locales/it.json";

const DICTS: Record<Locale, unknown> = { fr, en, es, de, it };

function lookup(dict: unknown, key: string): string | undefined {
  let cur = dict;
  for (const part of key.split(".")) {
    if (!cur || typeof cur !== "object" || !(part in cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

/** Server-side translator (emails, metadata) using the same locale files as the UI. */
export function serverT(locale: Locale) {
  return (key: string, params: Record<string, string | number> = {}) => {
    const s = lookup(DICTS[locale], key) ?? lookup(DICTS[DEFAULT_LOCALE], key) ?? key;
    return s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in params ? String(params[k]) : ""));
  };
}
