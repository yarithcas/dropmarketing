import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env, features } from "./env";
import type { AlertMatch } from "../alerts";
import type { AlertRule } from "../workspace";

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
  const lines = matches.slice(0, 20).map((m) => `• ${Object.values(m.params).join(" — ")}${m.link ? `\n  ${env.appUrl}${m.link}` : ""}`);
  await sendEmail(email, `TrendHunter · ${rule.name}`, `${rule.name}\n\n${lines.join("\n")}\n\nManage alerts: ${env.appUrl}/app/alerts`);
  await db.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("alert_id", rule.id).is("emailed_at", null);
}
