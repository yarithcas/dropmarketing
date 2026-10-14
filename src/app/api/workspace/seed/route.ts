import { cookies } from "next/headers";
import { json } from "@/lib/server/api";
import { demoWorkspace } from "@/lib/server/seed-workspace";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";

/** Example workspace for demo visitors (stored in their browser afterwards), in the visitor's language. */
export async function GET() {
  const lang = (await cookies()).get(LOCALE_COOKIE)?.value;
  return json(demoWorkspace(isLocale(lang) ? lang : DEFAULT_LOCALE));
}
