import "server-only";
import { env, features } from "./env";
import type { AlertMatch } from "../alerts";
import type { AlertRule } from "../workspace";
import { INTL_LOCALE, isLocale, DEFAULT_LOCALE } from "../i18n/config";
import { makeFormatters } from "../formatters";
import { notificationParams } from "../notification-text";
import { serverT } from "./messages";
import { supabaseAdmin } from "./supabase";

/**
 * Transactional email via Resend's HTTP API. Only active when RESEND_API_KEY is
 * configured; otherwise alerts are delivered in-app only (never silently "sent").
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!features().email) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.resendApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.emailFrom, to: [to], subject, text }),
    });
    return res.ok;
  } catch {
    return false; // network failure: reported as not sent
  }
}

/**
 * Emails one rule's matches to its owner. The address is looked up with the
 * service-role client (the auth admin API is not available to session clients).
 * `emailed_at` is stamped only once Resend accepted the message, and only on the
 * notifications inserted by this run. Returns whether the email was sent.
 */
export async function sendAlertEmail(userId: string, rule: AlertRule, matches: AlertMatch[], notificationIds: string[]): Promise<boolean> {
  if (!features().email) return false;
  const db = supabaseAdmin();
  if (!db) return false;
  const { data, error } = await db.auth.admin.getUserById(userId);
  const email = data?.user?.email;
  if (error || !email) return false;
  // Written in the recipient's interface language, with the same messages as in-app notifications.
  const { data: profile } = await db.from("profiles").select("locale").eq("user_id", userId).maybeSingle();
  const locale = isLocale(profile?.locale) ? profile.locale : DEFAULT_LOCALE;
  const t = serverT(locale);
  const f = makeFormatters(INTL_LOCALE[locale]);
  const lines = matches
    .slice(0, 20)
    .map((m) => `• ${t(m.key, notificationParams(m.params, f, (c) => t(`categories.${c}`)))}${m.link ? `\n  ${env.appUrl}${m.link}` : ""}`);
  const body = [t("email.intro", { rule: rule.name }), "", ...lines, "", t("email.manage", { url: `${env.appUrl}/app/alerts` }), "", t("email.footer")].join("\n");
  if (!(await sendEmail(email, t("email.subject", { rule: rule.name }), body))) return false;
  if (notificationIds.length) await db.from("notifications").update({ emailed_at: new Date().toISOString() }).in("id", notificationIds).eq("user_id", userId);
  return true;
}
