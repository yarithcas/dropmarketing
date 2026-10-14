import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env, features } from "./env";
import type { AlertMatch } from "../alerts";
import type { AlertRule } from "../workspace";
import { INTL_LOCALE, isLocale, DEFAULT_LOCALE } from "../i18n/config";
import { makeFormatters } from "../formatters";
import { notificationParams } from "../notification-text";
import { serverT } from "./messages";

/**
 * Transactional email via Resend's HTTP API. Only active when RESEND_API_KEY is
 * configured; otherwise alerts are delivered in-app only (never silently "sent").
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!features().email) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.resendApiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.emailFrom, to: [to], subject, text }),
  });
  return res.ok;
}

export async function sendAlertEmail(db: SupabaseClient, userId: string, rule: AlertRule, matches: AlertMatch[]) {
  if (!features().email) return;
  const { data } = await db.auth.admin.getUserById(userId);
  const email = data.user?.email;
  if (!email) return;
  // Written in the recipient's interface language, with the same messages as in-app notifications.
  const { data: profile } = await db.from("profiles").select("locale").eq("user_id", userId).maybeSingle();
  const locale = isLocale(profile?.locale) ? profile.locale : DEFAULT_LOCALE;
  const t = serverT(locale);
  const f = makeFormatters(INTL_LOCALE[locale]);
  const lines = matches
    .slice(0, 20)
    .map((m) => `• ${t(m.key, notificationParams(m.params, f, (c) => t(`categories.${c}`)))}${m.link ? `\n  ${env.appUrl}${m.link}` : ""}`);
  const body = [t("email.intro", { rule: rule.name }), "", ...lines, "", t("email.manage", { url: `${env.appUrl}/app/alerts` }), "", t("email.footer")].join("\n");
  await sendEmail(email, t("email.subject", { rule: rule.name }), body);
  await db.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("alert_id", rule.id).is("emailed_at", null);
}
